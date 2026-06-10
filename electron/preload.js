const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    send: (channel, data) => {
        // whitelist channels
        const validChannels = ['get-settings', 'save-settings'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        const validChannels = ['settings-data'];
        if (validChannels.includes(channel)) {
            // Deliberately strip event as it includes `sender`
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
