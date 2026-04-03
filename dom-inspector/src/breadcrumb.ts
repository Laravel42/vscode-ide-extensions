import * as vscode from 'vscode';
import { ComponentPathEntry } from './types';

/**
 * Displays the component hierarchy as a breadcrumb trail in the VSCode status bar.
 *
 * Uses a `vscode.StatusBarItem` to render clickable segments like:
 *   App > Header > Nav > Button
 *
 * When a segment is clicked, the registered callback is invoked with the
 * corresponding `ComponentPathEntry`.
 */
export class ComponentBreadcrumb {
  private statusBarItem: vscode.StatusBarItem;
  private components: ComponentPathEntry[] = [];
  private segmentClickedCallback: ((component: ComponentPathEntry) => void) | null = null;
  private commandDisposable: vscode.Disposable | null = null;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
  }

  /**
   * Register a callback invoked when the user clicks the breadcrumb.
   * A QuickPick is shown so the user can choose which segment to navigate to.
   */
  onSegmentClicked(callback: (component: ComponentPathEntry) => void): void {
    this.segmentClickedCallback = callback;
  }

  /**
   * Render the component path in the status bar.
   * Clicking the status bar item opens a QuickPick with all segments.
   */
  show(components: ComponentPathEntry[]): void {
    this.components = components;

    if (components.length === 0) {
      this.clear();
      return;
    }

    const label = components.map((c) => c.name).join(' > ');
    this.statusBarItem.text = `$(symbol-class) ${label}`;
    this.statusBarItem.tooltip = 'Click to navigate component hierarchy';

    // Register (or re-register) the command that opens the QuickPick
    this.registerCommand();

    this.statusBarItem.command = 'domInspector.breadcrumbClicked';
    this.statusBarItem.show();
  }

  /**
   * Hide the breadcrumb and reset state.
   */
  clear(): void {
    this.statusBarItem.hide();
    this.components = [];
  }

  /**
   * Clean up all resources.
   */
  dispose(): void {
    this.clear();
    this.statusBarItem.dispose();
    this.commandDisposable?.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private registerCommand(): void {
    // Dispose previous registration to avoid duplicates
    this.commandDisposable?.dispose();

    this.commandDisposable = vscode.commands.registerCommand(
      'domInspector.breadcrumbClicked',
      async () => {
        if (this.components.length === 0 || !this.segmentClickedCallback) {
          return;
        }

        // For a single component, invoke the callback directly
        if (this.components.length === 1) {
          this.segmentClickedCallback(this.components[0]);
          return;
        }

        // Multiple components — show a QuickPick so the user can choose
        const items = this.components.map((c) => ({
          label: c.name,
          description: c.sourceFile ?? undefined,
          component: c,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a component to navigate to',
        });

        if (picked && this.segmentClickedCallback) {
          this.segmentClickedCallback(picked.component);
        }
      },
    );
  }
}
