const { app, BrowserWindow, ipcMain } = require('electron/main')
const path = require('node:path')
const crawlSpiceEvent = require('./backend/crawlSpiceEvent.js')



// START //
const createWindow = () => {
  console.log(__dirname);
  console.log(path.join(__dirname, 'preload.js'));
  
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  console.log(__dirname);
  win.loadFile('app/page/add_tournament.html')
  // win.loadURL('https://www.mtgtop8.com/')
}
// START //


// INTERACTION // 
app.whenReady().then(() => {

  // defining the electron API
  ipcMain.handle('crawlSpiceEvent', async (event, spiceEventUrl, top_index) => {
    const result = await crawlSpiceEvent(spiceEventUrl, top_index);
    // console.log("result", result);
    return result;
  });

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})
// INTERACTION // 



app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

