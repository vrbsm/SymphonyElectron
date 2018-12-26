import * as electron from 'electron';
import { BrowserWindow, crashReporter, ipcMain, webContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { format, parse } from 'url';

import { buildNumber, clientVersion, version } from '../../package.json';
import DesktopCapturerSource = Electron.DesktopCapturerSource;
import { WindowTypes } from '../common/api-interface';
import { isMac, isWindowsOS } from '../common/env';
import { getCommandLineArgs, getGuid } from '../common/utils';
import { AppMenu } from './app-menu';
import { config, IConfig } from './config-handler';
import { handleChildWindow } from './pop-out-window-handler';
import { enterFullScreen, leaveFullScreen, throttledWindowChanges } from './window-actions';
import { createComponentWindow, getBounds } from './window-utils';

interface ICustomBrowserWindowConstructorOpts extends Electron.BrowserWindowConstructorOptions {
    winKey: string;
}

export interface ICustomBrowserWindow extends Electron.BrowserWindow {
    winName: string;
    notificationObj?: object;
}

// Default window width & height
const DEFAULT_WIDTH: number = 900;
const DEFAULT_HEIGHT: number = 900;

export class WindowHandler {

    /**
     * Loading window opts
     */
    private static getLoadingWindowOpts(): Electron.BrowserWindowConstructorOptions {
        return {
            alwaysOnTop: false,
            center: true,
            frame: false,
            height: 200,
            maximizable: false,
            minimizable: false,
            resizable: false,
            show: false,
            title: 'Symphony',
            width: 400,
        };
    }

    /**
     * Screen picker window opts
     */
    private static getScreenPickerWindowOpts(): ICustomBrowserWindowConstructorOpts {
        return {
            alwaysOnTop: true,
            autoHideMenuBar: true,
            frame: false,
            height: isMac ? 519 : 523,
            width: 580,
            modal: false,
            resizable: true,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                sandbox: true,
            },
            winKey: getGuid(),
        };
    }

    /**
     * Verifies if the url is valid and
     * forcefully appends https if not present
     *
     * @param configURL {string}
     */
    private static getValidUrl(configURL: string): string {
        const parsedUrl = parse(configURL);

        if (!parsedUrl.protocol || parsedUrl.protocol !== 'https') {
            parsedUrl.protocol = 'https:';
            parsedUrl.slashes = true;
        }
        return format(parsedUrl);
    }

    public appMenu: AppMenu | null;
    public isAutoReload: boolean;
    public isOnline: boolean;
    public url: string | undefined;

    private readonly windowOpts: ICustomBrowserWindowConstructorOpts;
    private readonly globalConfig: IConfig;
    private readonly config: IConfig;
    // Window reference
    private readonly windows: object;
    private readonly isCustomTitleBarAndWindowOS: boolean;

    private mainWindow: ICustomBrowserWindow | null;
    private loadingWindow: Electron.BrowserWindow | null;
    private aboutAppWindow: Electron.BrowserWindow | null;
    private moreInfoWindow: Electron.BrowserWindow | null;
    private screenPickerWindow: Electron.BrowserWindow | null;

    constructor(opts?: Electron.BrowserViewConstructorOptions) {
        // Settings
        this.config = config.getConfigFields([ 'isCustomTitleBar', 'mainWinPos' ]);
        this.globalConfig = config.getGlobalConfigFields([ 'url', 'crashReporter' ]);

        this.windows = {};
        this.windowOpts = { ...this.getMainWindowOpts(), ...opts };
        this.isAutoReload = false;
        this.isOnline = true;
        this.isCustomTitleBarAndWindowOS = isWindowsOS && this.config.isCustomTitleBar;

        this.appMenu = null;
        // Window references
        this.mainWindow = null;
        this.loadingWindow = null;
        this.aboutAppWindow = null;
        this.moreInfoWindow = null;
        this.screenPickerWindow = null;

        try {
            const extra = { podUrl: this.globalConfig.url, process: 'main' };
            crashReporter.start({ ...this.globalConfig.crashReporter, extra });
        } catch (e) {
            throw new Error('failed to init crash report');
        }
    }

    /**
     * Starting point of the app
     */
    public createApplication() {
        // set window opts with additional config
        this.mainWindow = new BrowserWindow({
            ...this.windowOpts, ...getBounds(this.config.mainWinPos, DEFAULT_WIDTH, DEFAULT_HEIGHT),
        }) as ICustomBrowserWindow;
        this.mainWindow.winName = 'main';

        // Event needed to hide native menu bar on Windows 10 as we use custom menu bar
        this.mainWindow.webContents.once('did-start-loading', () => {
            if ((this.config.isCustomTitleBar || isWindowsOS) && this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setMenuBarVisibility(false);
            }
        });

        const urlFromCmd = getCommandLineArgs(process.argv, '--url=', false);
        this.url = urlFromCmd && urlFromCmd.substr(6) || WindowHandler.getValidUrl(this.globalConfig.url);
        this.mainWindow.loadURL(this.url);
        this.mainWindow.webContents.on('did-finish-load', () => {
            // close the loading window when
            // the main windows finished loading
            if (this.loadingWindow) {
                this.loadingWindow.destroy();
                this.loadingWindow = null;
            }
            // early exit if the window has already been destroyed
            if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

            // Injects custom title bar css into the webContents
            if (this.mainWindow && this.isCustomTitleBarAndWindowOS) {
                this.mainWindow.webContents.insertCSS(
                    fs.readFileSync(path.join(__dirname, '..', '/renderer/styles/title-bar.css'), 'utf8').toString(),
                );
                this.mainWindow.webContents.send('initiate-custom-title-bar');
            }
            this.mainWindow.webContents.insertCSS(
                fs.readFileSync(path.join(__dirname, '..', '/renderer/styles/snack-bar.css'), 'utf8').toString(),
            );
            this.mainWindow.webContents.send('page-load', { isWindowsOS });
            this.appMenu = new AppMenu();
            this.monitorWindowActions();
            // Ready to show the window
            this.mainWindow.show();
        });
        this.mainWindow.webContents.toggleDevTools();
        this.addWindow(this.windowOpts.winKey, this.mainWindow);

        // Handle pop-outs window
        handleChildWindow(this.mainWindow.webContents);
        return this.mainWindow;
    }

    /**
     * Gets the main window
     */
    public getMainWindow(): ICustomBrowserWindow | null {
        return this.mainWindow;
    }

    /**
     * Gets all the window that we have created
     *
     * @return {Electron.BrowserWindow}
     *
     */
    public getAllWindows(): object {
        return this.windows;
    }

    /**
     * Closes the window from an event emitted by the render processes
     *
     * @param windowType
     */
    public closeWindow(windowType: WindowTypes) {
        switch (windowType) {
            case 'screen-picker':
                if (this.screenPickerWindow && !this.screenPickerWindow.isDestroyed()) this.screenPickerWindow.close();
        }
    }

    /**
     * Sets is auto reload when the application
     * is auto reloaded for optimizing memory
     *
     * @param shouldAutoReload {boolean}
     */
    public setIsAutoReload(shouldAutoReload: boolean) {
        this.isAutoReload = shouldAutoReload;
    }

    /**
     * Checks if the window and a key has a window
     *
     * @param key {string}
     * @param window {Electron.BrowserWindow}
     */
    public hasWindow(key: string, window: Electron.BrowserWindow): boolean {
        const browserWindow = this.windows[ key ];
        return browserWindow && window === browserWindow;
    }

    /**
     * Displays a loading window until the main
     * application is loaded
     */
    public showLoadingScreen() {
        this.loadingWindow = createComponentWindow('loading-screen', WindowHandler.getLoadingWindowOpts());
        this.loadingWindow.webContents.once('did-finish-load', () => {
            if (this.loadingWindow) {
                this.loadingWindow.webContents.send('data');
            }
        });

        this.loadingWindow.once('closed', () => this.loadingWindow = null);
    }

    /**
     * Creates a about app window
     */
    public createAboutAppWindow() {
        this.aboutAppWindow = createComponentWindow('about-app');
        this.aboutAppWindow.webContents.once('did-finish-load', () => {
            if (this.aboutAppWindow) {
                this.aboutAppWindow.webContents.send('about-app-data', { buildNumber, clientVersion, version });
            }
        });
    }

    /**
     * Creates a more info window
     */
    public createMoreInfoWindow() {
        this.moreInfoWindow = createComponentWindow('more-info-window');
        this.moreInfoWindow.webContents.once('did-finish-load', () => {
            if (this.aboutAppWindow) {
                this.aboutAppWindow.webContents.send('more-info-data');
            }
        });
    }

    /**
     * Creates a screen picker window
     */
    public createScreenPickerWindow(win: webContents, sources: DesktopCapturerSource[], id: number) {
        const opts = WindowHandler.getScreenPickerWindowOpts();
        this.screenPickerWindow = createComponentWindow('screen-picker-window', opts);
        this.screenPickerWindow.webContents.once('did-finish-load', () => {
            if (this.screenPickerWindow) {
                this.screenPickerWindow.webContents.send('screen-picker-data', { sources, id });
                this.addWindow(opts.winKey, this.screenPickerWindow);
                this.screenPickerWindow.once('closed', () => {
                    this.removeWindow(opts.winKey);
                    this.screenPickerWindow = null;
                });

                ipcMain.once('screen-source-selected', (_event, source) => {
                    win.send('start-share' + id, source);
                });
            }
        });
    }

    /**
     * Opens an external url in the system's default browser
     *
     * @param urlToOpen
     */
    public openUrlInDefaultBrowser(urlToOpen) {
        if (urlToOpen) {
            electron.shell.openExternal(urlToOpen);
        }
    }

    /**
     * Stores information of all the window we have created
     *
     * @param key {string}
     * @param browserWindow {Electron.BrowserWindow}
     */
    public addWindow(key: string, browserWindow: Electron.BrowserWindow): void {
        this.windows[ key ] = browserWindow;
    }

    /**
     * Removes the window reference
     *
     * @param key {string}
     */
    public removeWindow(key): void {
        delete this.windows[ key ];
    }

    /**
     * Saves the main window bounds
     */
    private monitorWindowActions(): void {
            const eventNames = [ 'move', 'resize', 'maximize', 'unmaximize' ];
            eventNames.forEach((event: string) => {
                // @ts-ignore
                if (this.mainWindow) this.mainWindow.on(event, throttledWindowChanges);
            });
            if (this.mainWindow) {
                this.mainWindow.on('enter-full-screen', enterFullScreen);
                this.mainWindow.on('leave-full-screen', leaveFullScreen);
            }
    }

    /**
     * Main window opts
     */
    private getMainWindowOpts(): ICustomBrowserWindowConstructorOpts {
        return {
            alwaysOnTop: false,
            frame: !this.isCustomTitleBarAndWindowOS,
            minHeight: 300,
            minWidth: 300,
            show: false,
            title: 'Symphony',
            webPreferences: {
                nodeIntegration: false,
                preload: path.join(__dirname, '../renderer/_preload-main.js'),
                sandbox: true,
            },
            winKey: getGuid(),
        };
    }
}

const windowHandler = new WindowHandler();

export { windowHandler };