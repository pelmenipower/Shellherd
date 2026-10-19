using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace Terminus.RdpHost
{
    /// <summary>Newline-delimited JSON over private stdin/stdout pipes. Serialized JSON never contains raw newlines.</summary>
    public static class Protocol
    {
        public const int Version = 1;
        public const int MaxMessageChars = 64 * 1024;

        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageChars };
        private static readonly object Gate = new object();
        private static StreamWriter output;

        public static void Init()
        {
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            output.AutoFlush = true;
        }

        public static void Send(Dictionary<string, object> message)
        {
            string line = Json.Serialize(message);
            lock (Gate)
            {
                try { output.Write(line); output.Write('\n'); }
                catch (IOException) { /* Parent is gone; stdin EOF ends the process. */ }
            }
        }

        public static Dictionary<string, object> Parse(string line)
        {
            var message = Json.Deserialize<Dictionary<string, object>>(line);
            if (message == null) throw new FormatException("Message must be a JSON object.");
            return message;
        }

        /// <summary>Reads one message line; returns null on EOF. Oversized lines are a protocol violation.</summary>
        public static string ReadLine(TextReader reader)
        {
            var line = new StringBuilder();
            while (true)
            {
                int next = reader.Read();
                if (next < 0) return line.Length > 0 ? line.ToString() : null;
                if (next == '\n') return line.ToString();
                if (line.Length >= MaxMessageChars) throw new InvalidDataException("Message too long.");
                line.Append((char)next);
            }
        }

        public static string String(Dictionary<string, object> message, string key, bool required)
        {
            object value;
            if (!message.TryGetValue(key, out value) || value == null)
            {
                if (required) throw new FormatException("Missing field: " + key);
                return null;
            }
            var text = value as string;
            if (text == null) throw new FormatException("Field must be a string: " + key);
            return text;
        }

        public static int Int(Dictionary<string, object> message, string key, int min, int max, int fallback)
        {
            object value;
            if (!message.TryGetValue(key, out value) || value == null) return fallback;
            if (!(value is int)) throw new FormatException("Field must be an integer: " + key);
            int number = (int)value;
            if (number < min || number > max) throw new FormatException("Field out of range: " + key);
            return number;
        }

        public static bool Bool(Dictionary<string, object> message, string key, bool fallback)
        {
            object value;
            if (!message.TryGetValue(key, out value) || value == null) return fallback;
            if (!(value is bool)) throw new FormatException("Field must be a boolean: " + key);
            return (bool)value;
        }

        public static Dictionary<string, object> Message(string type)
        {
            return new Dictionary<string, object> { { "type", type } };
        }
    }
}
