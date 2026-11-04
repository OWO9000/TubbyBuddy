const { contextBridge, ipcRenderer } = require("electron");

const deviceId = ipcRenderer.sendSync("desktop:device-id");

contextBridge.exposeInMainWorld("tubbyDesktop", {
  deviceId,
  platform: process.platform,
  state: () => ipcRenderer.invoke("desktop:state"),
  account: () => ipcRenderer.invoke("desktop:account"),
  signIn: () => ipcRenderer.invoke("desktop:sign-in"),
  cancelSignIn: () => ipcRenderer.invoke("desktop:cancel-sign-in"),
  signOut: () => ipcRenderer.invoke("desktop:sign-out"),
  useDemo: () => ipcRenderer.invoke("desktop:use-demo"),
  applySetup: (setup) => ipcRenderer.invoke("desktop:apply-setup", setup),
  openSettings: () => ipcRenderer.invoke("desktop:open-settings"),
  guardConfig: () => ipcRenderer.invoke("desktop:guard-config"),
  unlockApp: (appName) => ipcRenderer.invoke("desktop:unlock-app", appName),
  demoOff: () => ipcRenderer.invoke("desktop:demo-off"),
  putDown: () => ipcRenderer.invoke("overlay:put-down"),
  nudge: () => ipcRenderer.invoke("overlay:nudge"),
  continueAnyway: () => ipcRenderer.invoke("overlay:continue"),
  closeOverlay: () => ipcRenderer.invoke("overlay:close"),
  pauseGuard: () => ipcRenderer.invoke("overlay:pause"),
  quitApp: () => ipcRenderer.invoke("overlay:quit"),
  onPoints: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("desktop:points", handler);
    return () => ipcRenderer.removeListener("desktop:points", handler);
  },
});

contextBridge.exposeInMainWorld("tubbySettings", {
  load: () => ipcRenderer.invoke("settings:load"),
  apps: (force) => ipcRenderer.invoke("settings:apps", force),
  save: (next) => ipcRenderer.invoke("settings:save", next),
  close: () => ipcRenderer.invoke("settings:close"),
});
