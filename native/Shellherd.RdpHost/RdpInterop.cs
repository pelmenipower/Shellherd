using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Shellherd.RdpHost
{
    // Declarations follow the type library in %SystemRoot%\System32\mstscax.dll.
    // Dispatch interfaces are used late-bound; only vtable interfaces need exact slot order.

    [ComImport, Guid("336d5562-efa8-482e-8cb3-c5c0fc7a7db6"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IMsTscAxEvents
    {
        [DispId(1)] void OnConnecting();
        [DispId(2)] void OnConnected();
        [DispId(3)] void OnLoginComplete();
        [DispId(4)] void OnDisconnected(int discReason);
        [DispId(10)] void OnFatalError(int errorCode);
        [DispId(11)] void OnWarning(int warningCode);
        [DispId(12)] void OnRemoteDesktopSizeChange(int width, int height);
        [DispId(18)] void OnAuthenticationWarningDisplayed();
        [DispId(19)] void OnAuthenticationWarningDismissed();
        [DispId(22)] void OnLogonError(int lError);
        [DispId(23)] void OnFocusReleased(int iDirection);
    }

    [ComImport, Guid("c1e6743a-41c1-4a74-832a-0dd06c1c7a0e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMsTscNonScriptable
    {
        // Slot 3: put_ClearTextPassword.
        void SetClearTextPassword([MarshalAs(UnmanagedType.BStr)] string password);
    }

    [ComImport, Guid("2f079c4c-87b2-4afd-97ab-20cdb43038ae"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMsRdpClientNonScriptable
    {
        // Slots 3-13: IMsTscNonScriptable members and NotifyRedirectDeviceChange.
        void _VtblGap1_11();
        // Slot 14: SendKeys(numKeys, VARIANT_BOOL* keyUp, long* keyData) with scan codes.
        void SendKeys(int numKeys, [MarshalAs(UnmanagedType.LPArray)] short[] keyUp, [MarshalAs(UnmanagedType.LPArray)] int[] keyData);
    }

    [ComImport, Guid("4f6996d5-d7b1-412c-b0ff-063718566907"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMsRdpClientNonScriptable5
    {
        // Slots 3-62 are inherited members that are not used here.
        void _VtblGap1_60();
        // Slot 63: put_AllowPromptingForCredentials.
        void SetAllowPromptingForCredentials([MarshalAs(UnmanagedType.VariantBool)] bool allow);
    }

    public interface IRdpEventTarget
    {
        void Connecting();
        void Connected();
        void LoginComplete();
        void Disconnected(int reason);
        void FatalError(int code);
        void Warning(int code);
        void RemoteSizeChanged(int width, int height);
        void AuthenticationWarning(bool displayed);
        void LogonError(int code);
        void FocusReleased(int direction);
    }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    public sealed class RdpEventSink : IMsTscAxEvents
    {
        private readonly IRdpEventTarget target;
        public RdpEventSink(IRdpEventTarget target) { this.target = target; }
        public void OnConnecting() { target.Connecting(); }
        public void OnConnected() { target.Connected(); }
        public void OnLoginComplete() { target.LoginComplete(); }
        public void OnDisconnected(int discReason) { target.Disconnected(discReason); }
        public void OnFatalError(int errorCode) { target.FatalError(errorCode); }
        public void OnWarning(int warningCode) { target.Warning(warningCode); }
        public void OnRemoteDesktopSizeChange(int width, int height) { target.RemoteSizeChanged(width, height); }
        public void OnAuthenticationWarningDisplayed() { target.AuthenticationWarning(true); }
        public void OnAuthenticationWarningDismissed() { target.AuthenticationWarning(false); }
        public void OnLogonError(int lError) { target.LogonError(lError); }
        public void OnFocusReleased(int iDirection) { target.FocusReleased(iDirection); }
    }

    /// <summary>Hosts MsRdpClient9NotSafeForScripting without generated interop assemblies.</summary>
    public sealed class RdpControl : AxHost
    {
        public const string ClassId = "8b918b82-7985-4c24-89df-c33ad2bbfbcd";
        private readonly RdpEventSink sink;
        private ConnectionPointCookie cookie;

        public RdpControl(RdpEventSink sink) : base(ClassId) { this.sink = sink; }

        public object Ocx { get { return GetOcx(); } }

        protected override void CreateSink()
        {
            cookie = new ConnectionPointCookie(GetOcx(), sink, typeof(IMsTscAxEvents));
        }

        protected override void DetachSink()
        {
            if (cookie == null) return;
            cookie.Disconnect();
            cookie = null;
        }
    }
}
