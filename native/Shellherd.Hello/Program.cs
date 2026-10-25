using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using Windows.Foundation;
using Windows.Security.Credentials;
using Windows.Security.Cryptography;

namespace Shellherd.Hello
{
    /// <summary>
    /// One JSON request on stdin, one JSON line on stdout, then exit.
    /// Signs a 32-byte challenge with the Windows Hello key "Shellherd.VaultUnlock"; the signature is the only secret it prints.
    /// </summary>
    public static class Program
    {
        private const string KeyName = "Shellherd.VaultUnlock";
        // Window class of the Windows Hello prompt; without help it may open behind Shellherd.
        private const string PromptClass = "Credential Dialog Xaml Host";

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr window);

        public static int Main()
        {
            var json = new JavaScriptSerializer();
            Dictionary<string, object> reply;
            try
            {
                string line = Console.In.ReadLine();
                reply = Handle(line == null ? null : json.Deserialize<Dictionary<string, object>>(line));
            }
            catch (Exception)
            {
                reply = Failure("failed");
            }
            Console.Out.WriteLine(json.Serialize(reply));
            Console.Out.Flush();
            return 0;
        }

        private static Dictionary<string, object> Handle(Dictionary<string, object> request)
        {
            object op;
            if (request == null || !request.TryGetValue("op", out op)) return Failure("failed");
            if ("status".Equals(op))
            {
                var status = new Dictionary<string, object>();
                status["ok"] = true;
                status["available"] = Wait(KeyCredentialManager.IsSupportedAsync());
                return status;
            }
            if (!"sign".Equals(op)) return Failure("failed");

            object challengeText;
            object createValue;
            if (!request.TryGetValue("challenge", out challengeText) || !(challengeText is string)) return Failure("failed");
            byte[] challenge = Convert.FromBase64String((string)challengeText);
            if (challenge.Length != 32) return Failure("failed");
            bool create = request.TryGetValue("create", out createValue) && true.Equals(createValue);
            if (!Wait(KeyCredentialManager.IsSupportedAsync())) return Failure("unavailable");

            KeyCredentialRetrievalResult opened = Wait(KeyCredentialManager.OpenAsync(KeyName));
            if (opened.Status == KeyCredentialStatus.NotFound && create)
            {
                BringPromptForward();
                opened = Wait(KeyCredentialManager.RequestCreateAsync(KeyName, KeyCredentialCreationOption.FailIfExists));
            }
            if (opened.Status != KeyCredentialStatus.Success) return Failure(StatusText(opened.Status));

            BringPromptForward();
            KeyCredentialOperationResult signed = Wait(opened.Credential.RequestSignAsync(CryptographicBuffer.CreateFromByteArray(challenge)));
            if (signed.Status != KeyCredentialStatus.Success) return Failure(StatusText(signed.Status));
            byte[] signature;
            CryptographicBuffer.CopyToByteArray(signed.Result, out signature);
            var reply = new Dictionary<string, object>();
            reply["ok"] = true;
            reply["signature"] = Convert.ToBase64String(signature);
            return reply;
        }

        private static string StatusText(KeyCredentialStatus status)
        {
            if (status == KeyCredentialStatus.UserCanceled || status == KeyCredentialStatus.UserPrefersPassword) return "canceled";
            if (status == KeyCredentialStatus.NotFound) return "notFound";
            return "failed";
        }

        private static Dictionary<string, object> Failure(string status)
        {
            var reply = new Dictionary<string, object>();
            reply["ok"] = false;
            reply["status"] = status;
            return reply;
        }

        /// <summary>Blocks until the WinRT operation ends; Completed fires at once if it already has.</summary>
        private static T Wait<T>(IAsyncOperation<T> operation)
        {
            var done = new ManualResetEventSlim(false);
            operation.Completed = delegate { done.Set(); };
            done.Wait();
            return operation.GetResults();
        }

        /// <summary>Raises the Hello prompt once it exists (up to 5 s); allowed because Shellherd, the foreground process, started this one.</summary>
        private static void BringPromptForward()
        {
            var thread = new Thread(delegate ()
            {
                for (int attempt = 0; attempt < 50; attempt++)
                {
                    IntPtr prompt = FindWindow(PromptClass, null);
                    if (prompt != IntPtr.Zero) { SetForegroundWindow(prompt); return; }
                    Thread.Sleep(100);
                }
            });
            thread.IsBackground = true;
            thread.Start();
        }
    }
}
