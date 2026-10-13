using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Terminus.RdpHost
{
    public static class Program
    {
        [STAThread]
        public static int Main()
        {
            Application.SetCompatibleTextRenderingDefault(false);
            Protocol.Init();
            var context = new ApplicationContext();
            var host = new SessionHost(context);
            var reader = new Thread(host.ReadLoop) { IsBackground = true, Name = "stdin" };
            reader.Start();

            var hello = Protocol.Message("hello");
            hello["protocol"] = Protocol.Version;
            hello["control"] = "MsRdpClient9NotSafeForScripting";
            hello["pid"] = System.Diagnostics.Process.GetCurrentProcess().Id;
            Protocol.Send(hello);

            Application.Run(context);
            return 0;
        }
    }

    /// <summary>Receives commands on a background thread and executes them on the STA UI thread.</summary>
    public sealed class SessionHost
    {
        private const int MaxSessions = 16;
        private readonly ApplicationContext context;
        private readonly Control dispatcher = new Control();
        private readonly Dictionary<string, RdpSession> sessions = new Dictionary<string, RdpSession>();
        private readonly Queue<Action> pending = new Queue<Action>();
        private bool stopping, draining;

        public SessionHost(ApplicationContext context)
        {
            this.context = context;
            // Force handle creation on the UI thread so BeginInvoke works from the reader thread.
            var handle = dispatcher.Handle;
        }

        public void ReadLoop()
        {
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            try
            {
                string line;
                while ((line = Protocol.ReadLine(input)) != null)
                {
                    if (line.Trim().Length == 0) continue;
                    Dictionary<string, object> message;
                    try { message = Protocol.Parse(line); }
                    catch (Exception error) { SendError(null, "Ungültige Nachricht: " + error.Message); continue; }
                    Enqueue(() => Handle(message));
                }
            }
            catch (Exception error) { SendError(null, "Eingabekanal fehlerhaft: " + error.Message); }
            // stdin closed: the parent ended or wants us gone.
            Enqueue(Shutdown);
        }

        private void Enqueue(Action work)
        {
            lock (pending) pending.Enqueue(work);
            dispatcher.BeginInvoke((Action)Drain);
        }

        /// <summary>
        /// Runs commands strictly in order. Creating or calling the ActiveX control can pump messages;
        /// without this guard a later command (bounds, visible) could run before an earlier open finished.
        /// </summary>
        private void Drain()
        {
            if (draining) return;
            draining = true;
            try
            {
                while (true)
                {
                    Action work;
                    lock (pending)
                    {
                        if (pending.Count == 0) return;
                        work = pending.Dequeue();
                    }
                    work();
                }
            }
            finally { draining = false; }
        }

        private void Handle(Dictionary<string, object> message)
        {
            string requestId = null;
            try
            {
                requestId = Protocol.String(message, "requestId", false);
                string type = Protocol.String(message, "type", true);
                switch (type)
                {
                    case "open": Open(message, requestId); break;
                    case "close": Find(message).Close(); Reply("closing", requestId); break;
                    case "bounds": Find(message).SetBounds(Rect(message), Protocol.Int(message, "revision", 0, int.MaxValue, 0)); break;
                    case "visible": Find(message).SetVisible(Protocol.Bool(message, "visible", true)); break;
                    case "focus": Find(message).Focus(); break;
                    case "reparent": Find(message).Reparent(ParseHandle(Protocol.String(message, "parent", true))); break;
                    case "ping": Reply("pong", requestId); break;
                    case "action": Find(message).SendAction(Protocol.String(message, "action", true)); break;
                    default: throw new FormatException("Unbekannter Nachrichtentyp: " + type);
                }
            }
            catch (Exception error) { SendError(requestId, error.Message); }
        }

        private void Open(Dictionary<string, object> message, string requestId)
        {
            if (stopping) throw new InvalidOperationException("Der RDP-Helfer wird beendet.");
            var request = new OpenRequest
            {
                SessionId = Protocol.String(message, "sessionId", true),
                Server = Protocol.String(message, "server", true),
                Port = Protocol.Int(message, "port", 1, 65535, 3389),
                UserName = Protocol.String(message, "username", false),
                Domain = Protocol.String(message, "domain", false),
                Password = Protocol.String(message, "password", false),
                Clipboard = Protocol.Bool(message, "clipboard", true),
                Mode = ParseMode(Protocol.String(message, "mode", false)),
                Visible = Protocol.Bool(message, "visible", true),
                SmartResize = Protocol.Bool(message, "smartResize", true),
            };
            if (request.Mode == SurfaceMode.Window)
            {
                request.Width = Protocol.Int(message, "width", 200, 8192, 1280);
                request.Height = Protocol.Int(message, "height", 200, 8192, 800);
            }
            else
            {
                request.Parent = ParseHandle(Protocol.String(message, "parent", true));
                request.Bounds = Rect(message);
            }
            if (request.SessionId.Length == 0 || request.SessionId.Length > 64) throw new FormatException("Ungültige sessionId.");
            if (request.Server.Trim().Length == 0 || request.Server.Length > 255) throw new FormatException("Ungültiger Server.");
            if (sessions.ContainsKey(request.SessionId)) throw new InvalidOperationException("Sitzung existiert bereits.");
            if (sessions.Count >= MaxSessions) throw new InvalidOperationException("Maximal " + MaxSessions + " RDP-Sitzungen.");
            var session = new RdpSession(request, closed => sessions.Remove(closed.Id));
            sessions[session.Id] = session;
            var reply = Protocol.Message("opened");
            if (requestId != null) reply["requestId"] = requestId;
            reply["sessionId"] = session.Id;
            Protocol.Send(reply);
        }

        private static IntPtr ParseHandle(string text)
        {
            ulong handle;
            if (!ulong.TryParse(text, out handle) || handle == 0) throw new FormatException("Ungültiges Fensterhandle.");
            return new IntPtr(unchecked((long)handle));
        }

        private static SurfaceMode ParseMode(string mode)
        {
            switch (mode)
            {
                case null: case "window": return SurfaceMode.Window;
                case "child": return SurfaceMode.Child;
                case "owned": return SurfaceMode.Owned;
                default: throw new FormatException("Unbekannter Modus: " + mode);
            }
        }

        private static ScreenRect Rect(Dictionary<string, object> message)
        {
            const int Limit = 1 << 20;
            return new ScreenRect
            {
                X = Protocol.Int(message, "x", -Limit, Limit, 0),
                Y = Protocol.Int(message, "y", -Limit, Limit, 0),
                Width = Protocol.Int(message, "width", 1, 16384, 800),
                Height = Protocol.Int(message, "height", 1, 16384, 600),
            };
        }

        private RdpSession Find(Dictionary<string, object> message)
        {
            RdpSession session;
            if (!sessions.TryGetValue(Protocol.String(message, "sessionId", true), out session))
                throw new InvalidOperationException("Sitzung nicht gefunden.");
            return session;
        }

        private void Shutdown()
        {
            if (stopping) return;
            stopping = true;
            foreach (var session in new List<RdpSession>(sessions.Values)) session.Close();
            if (sessions.Count == 0) { context.ExitThread(); return; }
            // Give disconnects a moment, then exit regardless.
            var timer = new System.Windows.Forms.Timer { Interval = 100 };
            int ticks = 0;
            timer.Tick += (sender, e) => { if (sessions.Count == 0 || ++ticks > 60) { timer.Dispose(); context.ExitThread(); } };
            timer.Start();
        }

        private static void Reply(string type, string requestId)
        {
            var reply = Protocol.Message(type);
            if (requestId != null) reply["requestId"] = requestId;
            Protocol.Send(reply);
        }

        private static void SendError(string requestId, string message)
        {
            var error = Protocol.Message("error");
            if (requestId != null) error["requestId"] = requestId;
            error["message"] = message;
            Protocol.Send(error);
        }
    }
}
