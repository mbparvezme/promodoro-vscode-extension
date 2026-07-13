import * as vscode from 'vscode';
import { PomodoroManager, Config } from './lib/pomodoro';

let pomodoroManager: PomodoroManager | undefined;

/**
 * Loads configuration from VS Code settings.
 * @returns A Config object with all required settings.
 */
function loadConfig(): Config {
	const userConfig = vscode.workspace.getConfiguration('pomodoro');
	return {
		pomodoroDuration: userConfig.get<number>('pomodoroDuration', 25) * 60,
		shortBreakDuration: userConfig.get<number>('shortBreakDuration', 5) * 60,
		longBreakDuration: userConfig.get<number>('longBreakDuration', 20) * 60,
		showStatusDot: userConfig.get<boolean>('showStatusDot', true),
		showStatusLabel: userConfig.get<boolean>('showStatusLabel', true),
		pomodoroClock: userConfig.get<boolean>('pomodoroClock', true),
		confirmOnRestart: userConfig.get<boolean>('confirmOnRestart', true),
		autoPauseOnIdle: {
			enabled: userConfig.get<boolean>('autoPauseOnIdle.enabled', false),
			timeout: userConfig.get<number>('autoPauseOnIdle.timeout', 2)
		},
		sounds: {
			workStart: userConfig.get<string>('sounds.workStart', 'sound4.mp3'),
			shortBreakStart: userConfig.get<string>('sounds.shortBreakStart', 'sound1.wav'),
			longBreakStart: userConfig.get<string>('sounds.longBreakStart', 'sound2.wav')
		}
	};
}

/**
 * This method is called when your extension is activated.
 * @param context - The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext) {
	console.log("Pomodoro extension is now active!");

	const pomodoroStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	pomodoroStatusBar.tooltip = 'Click to Pause/Resume, Double-Click to Restart';
	pomodoroStatusBar.command = 'pomodoro.handleClick';
	pomodoroStatusBar.show();

	const initialConfig = loadConfig();
	// Pass the extension's root path to the manager for locating sound files
	pomodoroManager = new PomodoroManager(pomodoroStatusBar, initialConfig, context.extensionPath);

	pomodoroManager.start();

	// Register commands that delegate to the manager
	context.subscriptions.push(
		vscode.commands.registerCommand('pomodoro.handleClick', () => {
			pomodoroManager?.handleClick();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('pomodoro.restartTimer', () => {
			pomodoroManager?.restartTimer();
		})
	);
	
	context.subscriptions.push(
		vscode.commands.registerCommand('pomodoro.togglePause', () => {
			pomodoroManager?.togglePause();
		})
	);

	// --- Activity Listeners for Auto-Pause on Idle ---
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(() => {
			pomodoroManager?.onDidReceiveActivity();
		})
	);
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => {
			pomodoroManager?.onDidReceiveActivity();
		})
	);
    context.subscriptions.push(
		vscode.window.onDidChangeWindowState((e) => {
            if (e.focused) {
			    pomodoroManager?.onDidReceiveActivity();
            }
		})
	);


	// Handle configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('pomodoro')) {
				const newConfig = loadConfig();
				pomodoroManager?.updateConfig(newConfig);
			}
		})
	);

	context.subscriptions.push(pomodoroStatusBar);
	context.subscriptions.push(pomodoroManager);
}

/**
 * This method is called when your extension is deactivated.
 */
export function deactivate() {
	console.log("Pomodoro extension deactivated.");
}
