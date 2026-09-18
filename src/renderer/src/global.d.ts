interface DesktopApi {
  getVersion: () => Promise<string>;
}

interface Window {
  desktopApi: DesktopApi;
}
