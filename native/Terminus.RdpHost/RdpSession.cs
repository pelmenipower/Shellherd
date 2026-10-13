using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Terminus.RdpHost
{
    public sealed class OpenRequest
    {
        public string SessionId;
        public string Server;
        public int Port;
        public string UserName;
        public string Domain;
        public string Password;
        public int Width;
        public int Height;
        public bool Clipboard;
        public SurfaceMode Mode;
        public IntPtr Parent;
        public ScreenRect Bounds;
        public bool Visible;
        /// <summary>Scale the last frame while the remote resolution changes.</summary>
        public bool SmartResize;
    }

    /// <summary>
    /// One RDP connection. The control lives either in its own window (P2 harness) or in a surface
    /// embedded into the Terminus window (P3 variants A/B). All members run on the STA UI thread.
    /// </summary>
    public sealed class RdpSession : IRdpEventTarget
    {
        private const int MinSize = 200, MaxSize = 8192;
        // Disconnect reasons 1-3 are regular user/server disconnects, not errors.
        private const int LocalDisconnect = 1, RemoteByUser = 2, ByServer = 3;

        private readonly string id;
        private readonly SurfaceMode mode;
        private IntPtr parent;
        private readonly Form window;
        private int boundsRevision = -1;
        private readonly RdpControl control;
        // Wait for the user to stop resizing; every resolution change makes the server rebuild its graphics.
        private const int ResizeDelay = 500, UpdateTimeout = 4000, SizeTolerance = 8;
        private readonly Timer resizeTimer = new Timer { Interval = ResizeDelay };
        private readonly Timer updateTimer = new Timer { Interval = UpdateTimeout };
        private bool updatePending;
        private readonly Action<RdpSession> onClosed;
        private Timer closeTimer;
        private const int EUnexpected = unchecked((int)0x8000FFFF);
        private bool loggedIn, closing, closed;
        private int remoteWidth, remoteHeight, resizeRetries;
        private bool smartSizing;
        private readonly bool smartResize;

        public string Id { get { return id; } }

        public RdpSession(OpenRequest request, Action<RdpSession> onClosed)
        {
            id = request.SessionId;
            mode = request.Mode;
            smartResize = request.SmartResize;
            parent = request.Parent;
            this.onClosed = onClosed;
            if (mode == SurfaceMode.Window)
            {
                window = new Form
                {
                    Text = "Terminus RDP-Prototyp - " + request.Server,
                    ClientSize = new Size(request.Width, request.Height),
                    StartPosition = FormStartPosition.CenterScreen,
                };
            }
            else
            {
                if (!Native.IsWindow(parent)) throw new ArgumentException("Ungültiges Fensterhandle.");
                window = new SurfaceForm(mode == SurfaceMode.Owned ? parent : IntPtr.Zero);
                if (mode == SurfaceMode.Child) window.TopLevel = false;
            }
            control = new RdpControl(new RdpEventSink(this)) { Dock = DockStyle.Fill };
            window.Controls.Add(control);
            window.FormClosing += (sender, e) => { if (!closed) { e.Cancel = true; Close(); } };
            window.ClientSizeChanged += (sender, e) =>
            {
                // Scale the last frame immediately so the area never turns blank while the server catches up.
                Trace("surfaceResized", control.ClientSize.Width + "x" + control.ClientSize.Height);
                if (smartResize && loggedIn && !MatchesRemote()) SetSmartSizing(true);
                resizeTimer.Stop(); resizeTimer.Start();
            };
            resizeTimer.Tick += (sender, e) => { resizeTimer.Stop(); SyncDisplaySize(); };
            updateTimer.Tick += (sender, e) =>
            {
                // No answer: the server may not support dynamic resolution; keep the scaled image.
                updateTimer.Stop();
                updatePending = false;
                Trace("updateTimeout", remoteWidth + "x" + remoteHeight);
                if (!MatchesRemote()) { resizeTimer.Stop(); resizeTimer.Start(); }
            };
            if (mode != SurfaceMode.Window)
            {
                IntPtr handle = window.Handle;
                if (mode == SurfaceMode.Child && Native.SetParent(handle, parent) == IntPtr.Zero)
                    throw new InvalidOperationException("SetParent fehlgeschlagen: " + Marshal.GetLastWin32Error());
                SetBounds(request.Bounds, 0);
            }
            window.Show();
            if (mode != SurfaceMode.Window && !request.Visible) SetVisible(false);
            Connect(request);
        }

        /// <summary>Positions the surface. Bounds are physical screen pixels; stale revisions are ignored.</summary>
        public void SetBounds(ScreenRect bounds, int revision)
        {
            if (mode == SurfaceMode.Window || closed || revision <= boundsRevision) return;
            boundsRevision = revision;
            int width = Math.Max(1, bounds.Width), height = Math.Max(1, bounds.Height);
            if (mode == SurfaceMode.Child)
            {
                var origin = new Native.POINT { X = bounds.X, Y = bounds.Y };
                Native.ScreenToClient(parent, ref origin);
                Native.SetWindowPos(window.Handle, Native.HWND_TOP, origin.X, origin.Y, width, height, Native.SWP_NOACTIVATE);
            }
            else
            {
                Native.SetWindowPos(window.Handle, IntPtr.Zero, bounds.X, bounds.Y, width, height, Native.SWP_NOACTIVATE | Native.SWP_NOZORDER);
            }
        }

        /// <summary>Moves the surface to another Terminus window without touching the connection.</summary>
        public void Reparent(IntPtr newParent)
        {
            if (mode == SurfaceMode.Window || closed) return;
            if (!Native.IsWindow(newParent)) throw new ArgumentException("Ungültiges Fensterhandle.");
            parent = newParent;
            boundsRevision = -1;
            if (mode == SurfaceMode.Child) Native.SetParent(window.Handle, newParent);
            else Native.SetWindowLongPtr(window.Handle, Native.GWLP_HWNDPARENT, newParent);
        }

        public void SetVisible(bool visible)
        {
            if (mode == SurfaceMode.Window || closed) return;
            Native.ShowWindow(window.Handle, visible ? Native.SW_SHOWNA : Native.SW_HIDE);
        }

        public void Focus()
        {
            if (closed) return;
            control.Focus();
        }

        /// <summary>Fixed key actions; the renderer can only choose from this list.</summary>
        public void SendAction(string action)
        {
            if (!loggedIn || closing) throw new InvalidOperationException("Die RDP-Sitzung ist nicht angemeldet.");
            control.Focus();
            dynamic ocx = control.Ocx;
            switch (action)
            {
                case "ctrlAltDel":
                    // Scan codes Ctrl, Alt, Del pressed, then released in reverse order.
                    var keyUp = new short[] { 0, 0, 0, -1, -1, -1 };
                    var keyData = new[] { 0x1D, 0x38, 0x53, 0x53, 0x38, 0x1D };
                    ((IMsRdpClientNonScriptable)control.Ocx).SendKeys(keyData.Length, keyUp, keyData);
                    break;
                case "startScreen": ocx.SendRemoteAction(3); break;
                case "appSwitch": ocx.SendRemoteAction(4); break;
                case "actionCenter": ocx.SendRemoteAction(5); break;
                case "taskManager": ocx.SendRemoteAction(6); break;
                default: throw new FormatException("Unbekannte Aktion: " + action);
            }
        }

        private void Connect(OpenRequest request)
        {
            dynamic ocx = control.Ocx;
            ocx.Server = request.Server;
            if (request.UserName != null) ocx.UserName = request.UserName;
            if (request.Domain != null) ocx.Domain = request.Domain;
            ocx.DesktopWidth = Even(control.ClientSize.Width);
            ocx.DesktopHeight = Even(control.ClientSize.Height);
            ocx.ColorDepth = 32;

            dynamic settings = ocx.AdvancedSettings9;
            settings.RDPPort = request.Port;
            settings.EnableCredSspSupport = true;
            // 2 = warn on failed server authentication; the control shows its own dialog.
            settings.AuthenticationLevel = (uint)2;
            settings.RedirectClipboard = request.Clipboard;
            settings.RedirectDrives = false;
            settings.RedirectPrinters = false;
            settings.RedirectPorts = false;
            settings.RedirectSmartCards = false;
            settings.RedirectDevices = false;
            // Reconnects are explicit user actions, never automatic.
            settings.EnableAutoReconnect = false;
            settings.SmartSizing = false;
            settings.ContainerHandledFullScreen = 1;

            if (request.Password != null) ((IMsTscNonScriptable)control.Ocx).SetClearTextPassword(request.Password);
            else ((IMsRdpClientNonScriptable5)control.Ocx).SetAllowPromptingForCredentials(true);
            request.Password = null;

            ocx.Connect();
        }

        private static int Even(int value)
        {
            int clamped = Math.Max(MinSize, Math.Min(MaxSize, value));
            return clamped - clamped % 2;
        }

        /// <summary>Servers may round the requested size (e.g. to multiples of 4); a few pixels count as a match.</summary>
        private bool MatchesRemote()
        {
            return Math.Abs(Even(control.ClientSize.Width) - remoteWidth) <= SizeTolerance
                && Math.Abs(Even(control.ClientSize.Height) - remoteHeight) <= SizeTolerance;
        }

        /// <summary>Scales the remote image to the surface; stays on if the server cannot resize dynamically.</summary>
        private void SetSmartSizing(bool enabled)
        {
            if (smartSizing == enabled || (enabled && !smartResize)) return;
            Trace("smartSizing", enabled ? "on" : "off");
            try { ((dynamic)control.Ocx).AdvancedSettings9.SmartSizing = enabled; smartSizing = enabled; }
            catch { /* control not ready; the next resize retries */ }
        }

        private void SyncDisplaySize()
        {
            if (!loggedIn || closing) return;
            int width = Even(control.ClientSize.Width), height = Even(control.ClientSize.Height);
            if (MatchesRemote()) { SetSmartSizing(false); return; }
            SetSmartSizing(true);
            // One resolution change at a time; the remote size event or the timeout releases the next one.
            if (updatePending) { Trace("updateDeferred", width + "x" + height); return; }
            try
            {
                dynamic ocx = control.Ocx;
                Trace("updateDisplay", width + "x" + height);
                ocx.UpdateSessionDisplaySettings((uint)width, (uint)height, (uint)width, (uint)height, (uint)0, (uint)100, (uint)100);
                resizeRetries = 0;
                updatePending = true;
                updateTimer.Stop(); updateTimer.Start();
            }
            catch (COMException error)
            {
                // Right after login the control rejects updates with E_UNEXPECTED; retry a few times.
                if (error.ErrorCode == EUnexpected && ++resizeRetries <= 5) { resizeTimer.Interval = 1000; resizeTimer.Start(); return; }
                resizeRetries = 0;
                Trace("updateDisplayFailed", error.Message);
                Status("warning", 0, "Auflösung konnte nicht angepasst werden: " + error.Message);
            }
            finally { if (resizeRetries == 0) resizeTimer.Interval = ResizeDelay; }
        }

        public void Close()
        {
            if (closed || closing) return;
            closing = true;
            int state = 0;
            try { state = Convert.ToInt32(((dynamic)control.Ocx).Connected); } catch { }
            if (state == 0) { Finish(); return; }
            try { ((dynamic)control.Ocx).Disconnect(); } catch { Finish(); return; }
            // OnDisconnected finishes the session; the timer guarantees cleanup if it never arrives.
            closeTimer = new Timer { Interval = 5000 };
            closeTimer.Tick += (sender, e) => Finish();
            closeTimer.Start();
        }

        private void Finish()
        {
            if (closed) return;
            closed = true;
            resizeTimer.Dispose();
            updateTimer.Dispose();
            if (closeTimer != null) closeTimer.Dispose();
            try { control.Dispose(); } catch { }
            window.Close();
            window.Dispose();
            Status("closed", 0, null);
            onClosed(this);
        }

        /// <summary>Diagnostics only; the main process logs these with TERMINUS_RDP_DEBUG=1.</summary>
        private void Trace(string name, string detail)
        {
            var payload = Protocol.Message("trace");
            payload["sessionId"] = id;
            payload["event"] = name;
            payload["detail"] = detail;
            payload["ms"] = Environment.TickCount;
            Protocol.Send(payload);
        }

        private void Status(string status, int code, string message)
        {
            Status(status, code, message, null);
        }

        private void Status(string status, int code, string message, Dictionary<string, object> extra)
        {
            var payload = extra ?? Protocol.Message("status");
            payload["type"] = "status";
            payload["sessionId"] = id;
            payload["status"] = status;
            if (code != 0) payload["code"] = code;
            if (message != null) payload["message"] = message;
            Protocol.Send(payload);
        }

        private string Describe(int reason)
        {
            try
            {
                dynamic ocx = control.Ocx;
                return (string)ocx.GetErrorDescription((uint)reason, Convert.ToUInt32(ocx.ExtendedDisconnectReason));
            }
            catch { return null; }
        }

        public void Connecting() { Status("connecting", 0, null); }
        public void Connected() { Status("connected", 0, null); }

        public void LoginComplete()
        {
            loggedIn = true;
            Status("loginComplete", 0, null);
            SyncDisplaySize();
        }

        public void Disconnected(int reason)
        {
            loggedIn = false;
            // A disconnect we requested is never an error, whatever reason code the control reports.
            bool regular = closing || reason == LocalDisconnect || reason == RemoteByUser || reason == ByServer;
            var extra = new Dictionary<string, object>();
            try { extra["extendedReason"] = Convert.ToInt32(((dynamic)control.Ocx).ExtendedDisconnectReason); } catch { }
            extra["requested"] = closing;
            Status(regular ? "disconnected" : "error", reason, Describe(reason), extra);
            if (closing) Finish();
        }

        public void FatalError(int code) { Status("error", code, "Schwerer Fehler im RDP-Control."); }
        public void Warning(int code) { Status("warning", code, null); }
        public void RemoteSizeChanged(int width, int height)
        {
            remoteWidth = width;
            remoteHeight = height;
            bool answered = updatePending;
            updatePending = false;
            updateTimer.Stop();
            if (loggedIn && MatchesRemote()) SetSmartSizing(false);
            // The surface may have changed again while the server was busy.
            else if (answered && loggedIn) { resizeTimer.Stop(); resizeTimer.Start(); }
            Status("remoteSize", 0, width + "x" + height);
        }
        public void AuthenticationWarning(bool displayed) { Status(displayed ? "authWarningShown" : "authWarningDismissed", 0, null); }
        public void LogonError(int code) { Status("logonError", code, null); }
        public void FocusReleased(int direction) { Status("focusReleased", direction, null); }
    }
}
