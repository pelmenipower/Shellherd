using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Terminus.RdpHost
{
    /// <summary>How the RDP surface is placed relative to the Terminus window.</summary>
    public enum SurfaceMode
    {
        /// <summary>Own top-level window (P2 harness).</summary>
        Window,
        /// <summary>Variant A: child window of the Electron window (SetParent across processes).</summary>
        Child,
        /// <summary>Variant B: borderless popup owned by the Electron window; separate input queue.</summary>
        Owned,
    }

    public struct ScreenRect
    {
        public int X, Y, Width, Height;
    }

    /// <summary>Borderless container window for one RDP control.</summary>
    public sealed class SurfaceForm : Form
    {
        private const int WS_POPUP = unchecked((int)0x80000000), WS_CLIPCHILDREN = 0x02000000;
        private const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
        private readonly IntPtr owner;

        public SurfaceForm(IntPtr owner)
        {
            this.owner = owner;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            BackColor = System.Drawing.Color.FromArgb(7, 11, 20);
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var parameters = base.CreateParams;
                if (owner != IntPtr.Zero)
                {
                    // For a top-level window, the parent handle is its owner: it stays above and minimizes with Terminus.
                    parameters.Parent = owner;
                    parameters.Style = WS_POPUP | WS_CLIPCHILDREN;
                    parameters.ExStyle |= WS_EX_TOOLWINDOW;
                }
                return parameters;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }
    }

    public static class Native
    {
        public static readonly IntPtr HWND_TOP = IntPtr.Zero;
        public const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010;
        public const int SW_HIDE = 0, SW_SHOWNA = 8;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X, Y; }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetParent(IntPtr child, IntPtr parent);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr window, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ScreenToClient(IntPtr window, ref POINT point);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindow(IntPtr window);

        /// <summary>For top-level windows, GWLP_HWNDPARENT changes the owner.</summary>
        public const int GWLP_HWNDPARENT = -8;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
    }
}
