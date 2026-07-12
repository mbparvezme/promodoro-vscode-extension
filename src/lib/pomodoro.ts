import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';

// You must run 'npm install play-sound' for this to work.
const player = require('play-sound')({});

/**
 * The single source of truth for the sounds bundled with the extension.
 * They live in the top-level `sounds/` folder.
 *
 * To add a new bundled sound: drop the file into `sounds/`, add its filename
 * here, and add it to the `enum` list of every `pomodoro.sounds.*` property in
 * package.json (so it appears in the settings dropdowns).
 */
export const BUNDLED_SOUNDS = ['sound1.wav', 'sound2.wav', 'sound3.wav', 'sound4.mp3'];

/** Value used in the sound dropdowns to disable audio for an event. */
export const NO_SOUND = 'none';

/**
 * Interface for the Pomodoro configuration settings.
 */
export interface Config {
	pomodoroDuration: number;
	shortBreakDuration: number;
	longBreakDuration: number;
	pomodoroClock: boolean;
	confirmOnRestart: boolean;
	autoPauseOnIdle: {
		enabled: boolean;
		timeout: number; // in minutes
	};
	sounds: {
		workStart: string;       // returning to work after a break
		shortBreakStart: string; // a short break begins
		longBreakStart: string;  // a long break begins
	};
}

/**
 * Manages the entire state and logic of the Pomodoro timer.
 */
export class PomodoroManager implements vscode.Disposable {
	private config: Config;
	private statusBarItem: vscode.StatusBarItem;
	private extensionPath: string;

	// State variables
	private isPaused: boolean = false;
	private wasPausedByIdle: boolean = false; // NEW: Tracks if pause was automatic
	private isBreak: boolean = false;
	private pomodoroCount: number = 0;
	private timerInterval: NodeJS.Timeout | undefined;
	private secondsRemaining: number = 0;
	private idleTimeout: NodeJS.Timeout | undefined;

	// Click handling variables
	private clickTimeout: NodeJS.Timeout | undefined;
	private readonly clickDelay = 250; // ms

	constructor(statusBarItem: vscode.StatusBarItem, initialConfig: Config, extensionPath: string) {
		this.statusBarItem = statusBarItem;
		this.config = initialConfig;
		this.extensionPath = extensionPath;
		this.secondsRemaining = this.config.pomodoroDuration;
		this.updateStatusBar();
	}

	public start() {
		// The very first work session at launch is silent.
		this.startPomodoro(false, true);
	}

	public handleClick() {
		if (this.clickTimeout) {
			clearTimeout(this.clickTimeout);
			this.clickTimeout = undefined;
			this.restartTimer();
		} else {
			this.clickTimeout = setTimeout(() => {
				this.clickTimeout = undefined;
				this.togglePause();
			}, this.clickDelay);
		}
	}

	public async restartTimer() {
		if (this.config.confirmOnRestart) {
			const choice = await vscode.window.showWarningMessage(
				'Are you sure you want to restart the current session?',
				{ modal: true },
				'Restart'
			);
			if (choice !== 'Restart') {
				return;
			}
		}

		this.stopTimer();
		if (this.isBreak) {
			this.startBreak(true);
		} else {
			this.startPomodoro(true);
		}
		vscode.window.showInformationMessage('Pomodoro timer restarted.');
	}

	/**
	 * Toggles the timer between paused and running states. This is for MANUAL user actions.
	 */
	public togglePause() {
		if (this.isPaused) {
			// --- Resume ---
			this.isPaused = false;
			this.wasPausedByIdle = false; // Always reset flag on any resume
			this.startTimer(this.secondsRemaining);
			if (!this.isBreak) {
				this.resetIdleTimer();
			}
		} else {
			// --- Manual Pause ---
			this.isPaused = true;
			this.wasPausedByIdle = false; // Explicitly set to false for manual pause
			this.stopTimer();
			this.updateStatusBar();
		}
	}

	/**
	 * Called by listeners when user activity is detected. Handles auto-resume and idle timer reset.
	 */
	public onDidReceiveActivity() {
		// --- Auto-Resume Logic ---
		if (this.isPaused && this.wasPausedByIdle) {
			this.togglePause(); // This will resume the timer
			vscode.window.showInformationMessage("Pomodoro timer resumed.");
			return; // Exit after resuming
		}

		// --- Idle Timer Reset Logic ---
		if (this.config.autoPauseOnIdle.enabled && this.timerInterval && !this.isBreak && !this.isPaused) {
			this.resetIdleTimer();
		}
	}

	private startPomodoro(isRestart: boolean = false, isInitial: boolean = false) {
		if (!isRestart) {
			if (this.pomodoroCount % 4 === 0) {
				this.pomodoroCount = 0;
			}
			// Silent at launch; otherwise this is a return to work after a break.
			if (!isInitial) {
				this.playSound(this.config.sounds.workStart);
			}
		}
		this.isBreak = false;
		this.isPaused = false;
		this.wasPausedByIdle = false;
		this.startTimer(this.config.pomodoroDuration);
		this.resetIdleTimer();
	}

	private startBreak(isRestart: boolean = false) {
		this.isBreak = true;
		this.isPaused = false;
		this.wasPausedByIdle = false;

		const isLongBreak = this.pomodoroCount % 4 === 0;
		this.secondsRemaining = isLongBreak ? this.config.longBreakDuration : this.config.shortBreakDuration;

		if (!isRestart) {
			this.playSound(isLongBreak ? this.config.sounds.longBreakStart : this.config.sounds.shortBreakStart);
		}

		this.startTimer(this.secondsRemaining);

		if (isLongBreak && !isRestart) {
			this.pomodoroCount = 0;
		}
	}
	
	private startTimer(duration: number) {
		this.secondsRemaining = duration;
		this.updateStatusBar();

		this.timerInterval = setInterval(() => {
			this.secondsRemaining--;
			this.updateStatusBar();

			if (this.secondsRemaining <= 0) {
				this.onTimerFinished();
			}
		}, 1000);
	}

	private stopTimer() {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = undefined;
		}
		this.clearIdleTimer();
	}

	private onTimerFinished() {
		this.stopTimer();

		if (this.isBreak) {
			this.showTimedInformationMessage('🟢 Break is over! Time to get back to work.', 3000);
			this.startPomodoro();
		} else {
			this.pomodoroCount++;
			this.showTimedInformationMessage(this.makePomodoroEndNotification(), 3000);
			this.startBreak();
		}
	}

	private updateStatusBar() {
		const minutes = Math.floor(this.secondsRemaining / 60).toString().padStart(2, '0');
		const seconds = (this.secondsRemaining % 60).toString().padStart(2, '0');

		let text: string;
		if (this.isPaused) {
			text = `⏸️ Paused ${minutes}:${seconds}`;
		} else {
			const icon = this.isBreak ? '🔴' : '🟢';
			const type = this.isBreak ? `${this.readableNumber()} Break` : 'Work';
			text = `${icon} ${type}`;
			if (this.config.pomodoroClock) {
				text += ` ${minutes}:${seconds}`;
			}
		}

		this.statusBarItem.text = text;
		this.statusBarItem.color = this.isBreak
			? new vscode.ThemeColor('pomodoro.breakTextColor')
			: new vscode.ThemeColor('statusBar.foreground');
	}

	public updateConfig(newConfig: Config) {
		const wasAutoPauseEnabled = this.config.autoPauseOnIdle.enabled;
		this.config = newConfig;

		if (this.config.autoPauseOnIdle.enabled && !wasAutoPauseEnabled) {
			this.resetIdleTimer();
		} else if (!this.config.autoPauseOnIdle.enabled && wasAutoPauseEnabled) {
			this.clearIdleTimer();
		}

		if (!this.timerInterval && !this.isPaused) {
			this.secondsRemaining = this.config.pomodoroDuration;
			this.updateStatusBar();
		}
		vscode.window.showInformationMessage('Pomodoro settings updated. Changes will apply to the next session.');
	}

	public dispose() {
		this.stopTimer();
		if (this.clickTimeout) {
			clearTimeout(this.clickTimeout);
		}
	}

	/**
	 * Pauses the timer automatically due to inactivity.
	 */
	private autoPause() {
		if (this.timerInterval && !this.isPaused && !this.isBreak) {
			this.isPaused = true;
			this.wasPausedByIdle = true; // Set the flag for auto-resume
			this.stopTimer();
			this.updateStatusBar();
			vscode.window.showInformationMessage("Pomodoro paused due to inactivity.");
		}
	}
	
	private resetIdleTimer() {
		if (!this.config.autoPauseOnIdle.enabled) return;
		this.clearIdleTimer();
		this.idleTimeout = setTimeout(() => {
			this.autoPause();
		}, this.config.autoPauseOnIdle.timeout * 60 * 1000);
	}

	private clearIdleTimer() {
		if (this.idleTimeout) {
			clearTimeout(this.idleTimeout);
			this.idleTimeout = undefined;
		}
	}
	
	/**
	 * Plays the given sound. `sound` is either a bundled filename (resolved
	 * inside the extension's `sounds/` folder) or an absolute path to the
	 * user's own file. The value `'none'` (or empty) disables audio for the event.
	 */
	private playSound(sound: string) {
		const soundPath = this.resolveSoundPath(sound);
		if (!soundPath) {
			return;
		}

		player.play(soundPath, (err: any) => {
			if (err) {
				console.error(`Pomodoro Error: Could not play sound at ${soundPath}.`, err);
				const command = process.platform === 'win32' ? 'cmd /c echo \x07' : 'echo -e "\a"';
				exec(command);
			}
		});
	}

	/**
	 * Resolves a configured sound value to an absolute file path, or `undefined`
	 * if the event should be silent.
	 */
	private resolveSoundPath(sound: string): string | undefined {
		if (!sound || sound === NO_SOUND) {
			return undefined;
		}
		// Allow users to point a setting at their own sound file anywhere on disk.
		if (path.isAbsolute(sound)) {
			return sound;
		}
		return path.join(this.extensionPath, 'sounds', sound);
	}
	
	private readableNumber(forNotification: boolean = false): string {
		if (this.pomodoroCount % 4 === 0) {
			return forNotification ? '4th' : 'Long';
		}
		const suffixes = ['st', 'nd', 'rd'];
		const count = this.pomodoroCount % 4;
		return `${count}${suffixes[count - 1] || 'th'}`;
	}

	private makePomodoroEndNotification(): string {
		const isLongBreak = (this.pomodoroCount % 4 === 0);
		const breakType = isLongBreak ? `${this.config.longBreakDuration / 60} minute long` : "short";
		return `🔴 ${this.readableNumber(true)} Pomodoro completed! Time for a ${breakType} break.`;
	}

	private showTimedInformationMessage(message: string, duration: number) {
		vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: message,
			cancellable: false
		}, (progress) => {
			return new Promise<void>(resolve => {
				setTimeout(() => {
					resolve();
				}, duration);
			});
		});
	}
}
