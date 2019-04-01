import { cleanUpAppCache } from '../src/app/app-cache-handler';
import '../src/app/main';
import { windowHandler } from '../src/app/window-handler';
import { app, ipcRenderer } from './__mocks__/electron';

jest.mock('electron-log');

jest.mock('../src/app/auto-launch-controller', () => {
    return {
        protocolHandler: jest.fn(),
    };
});

jest.mock('../src/app/app-cache-handler', () => {
    return {
        cleanUpAppCache: jest.fn(),
    };
});

jest.mock('../src/app/config-handler', () => {
    return {
        config: jest.fn(),
    };
});

jest.mock('../src/app/dialog-handler', () => {
    return {
        dialogHandler: jest.fn(),
    };
});

jest.mock('../src/app/protocol-handler', () => {
    return {
        autoLaunchInstance: jest.fn(),
    };
});

jest.mock('../src/app/main-api-handler', () => {
    return {
        mainApiHandler: jest.fn(),
    };
});

jest.mock('../src/app/spell-check-handler', () => {
    return {
        SpellChecker: jest.fn(),
    };
});

jest.mock('../src/app/window-handler', () => {
    return {
        windowHandler: jest.fn(),
    };
});

describe('main', () => {

    describe('events', () => {

        it('should call `window-all-closed` correctly', () => {
            const spy = jest.spyOn(app, 'quit');
            ipcRenderer.send('window-all-closed');
            expect(spy).toBeCalled();
        });

        it('should call `quit` correctly', () => {
            ipcRenderer.send('quit');
            expect(cleanUpAppCache).toBeCalled();
        });

        it('should call `before-quit` correctly', () => {
            ipcRenderer.send('before-quit');
            expect(windowHandler.willQuitApp).toBeTruthy();
        });
    });
});
