import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

function log(msg: string, ...args: any[]): void {
  console.warn("multimonitorwm: " + msg, ...args);
}

/**
 * Manages the lifecycle of a Workspace, when a new workspace comes into existence
 * we register it here. And when the workspace is removed we pop it.
 */
class Workspaces {
  constructor(
    private workspaces: Map<number, Workspace> = new Map()
  ) {}
  
  add(index: number, workspace: Meta.Workspace): void {
    this.workspaces.set(index, new Workspace(workspace));
  }
  
  pop(index: number): Workspace|null {
    const workspace = this.workspaces.get(index);
    
    if (workspace) {
      this.workspaces.delete(index);
      return workspace;
    }
      
    return null;
  }
}

class Window {
  private monitorChangedId: number|null = null;

  constructor(public window: Meta.Window) {
    this.monitorChangedId = window.connect('highest-scale-monitor-changed', this.onMonitorChanged.bind(this));
  }
  
  onMonitorChanged(): void {
    log("Monitor changed for window", this.window.get_title());
  }
  
  destroy(): void {
    log("Destroying window", this.window?.get_title());
    if (this.monitorChangedId) {
      this.window.disconnect(this.monitorChangedId);
    }
    // @ts-ignore
    this.window = null;
  }
}

class Windows {
  constructor(
    private windows: Window[] = []
  ) {}
  
  add(window: Meta.Window): void {
    this.windows.push(new Window(window));
  }
  
  find(window: Meta.Window): Window|undefined {
    return this.windows.find(w => w.window = window);
  }
  
  remove(window: Window): void {
    this.windows = this.windows.filter(w => w !== window);
  }

  destroy(): void {
    log("Destroying all windows");
    this.windows.forEach(window => window.destroy());
    // @ts-ignore manual memory management
    this.windows = null;
  }
}

class Workspace {
  private windowAddedId: number|null = null;
  private windowRemovedId: number|null = null;
  
  private windows: Windows = new Windows();

  constructor(private workspace: Meta.Workspace) {
    this.windowAddedId = workspace.connect('window-added', this.onWindowAdded.bind(this));
    this.windowRemovedId = workspace.connect('window-removed', this.onWindowRemoved.bind(this));
  }
  
  onWindowAdded(_workspace: Meta.Workspace, window: Meta.Window): void {
    log("Window added", window.get_title());
    this.windows.add(window);
  }
  onWindowRemoved(_workspace: Meta.Workspace, window: Meta.Window): void {
    log("Window removed", window.get_title());
    const w = this.windows.find(window);
    
    if (w) {
      this.windows.remove(w);
      w.destroy();
    }
  }
  
  destroy(): void {
    log("Destroying workspace", this.workspace.index());
    if (this.windowAddedId) {
      this.workspace.disconnect(this.windowAddedId);
      this.windowAddedId = null;
    }
    if (this.windowRemovedId) {
      this.workspace.disconnect(this.windowRemovedId);
      this.windowRemovedId = null;
    }
    
    this.windows.destroy();
    // @ts-ignore
    this.windows = null;
    
    // @ts-ignore manual memory management of gobjects we expect this.workspace to
    // always be set when an instance of this exists
    this.workspace = null;
  }
}

export default class MultiMonitorWM extends Extension {
  private monitorsChangedId: number|null = null;
  
  private workspaceAddedId: number|null = null;
  private workspaceRemovedId: number|null = null;
  private workspaceReorderedId: number|null = null;
  private workspaceSwitchedId: number|null = null;
  
  private workspaces: Workspaces = new Workspaces();
  
  private log(message: string, ...args: any[]): void {
    log("multimonitorwm: " + message, ...args);
  }

  enable(): void {
    this.connectSignals();
  }

  disable(): void {
    this.disconnectSignals();
  }
  
  onMonitorsChanged(monitorManager: Meta.MonitorManager): void {
    const monitors = monitorManager.get_monitors();
    if (monitors === null) return;
    
    for (let i = 0; i < monitors.length; i++) {
      const monitor = monitors[i];
      const geom = global.display.get_monitor_geometry(i);
      log("Monitor changed", monitor.get_display_name(), geom.width, geom.height);
    }
  }
  
  onWorkspaceAdded(manager: Meta.WorkspaceManager, num: number): void {
    log("Workspace added", num);
    const workspace = manager.get_workspace_by_index(num);
    
    if (workspace === null) {
      console.warn("Workspace added but not returned", num);
      return;
    }
    
    this.workspaces.add(num, workspace);
  }
  
  onWorkspaceRemoved(manager: Meta.WorkspaceManager, num: number): void {
    log("Workspace removed", num);
    const workspace = this.workspaces.pop(num);

    if (workspace) {
      workspace.destroy();
    }
  }

  onWorkspaceReordered(manager: Meta.WorkspaceManager): void {
    log("Workspace reordered");
  }

  onWorkspaceSwitched(manager: Meta.WorkspaceManager, from: number, to: number, direction: Meta.MotionDirection): void {
    log("Workspace switched", from, to, direction);
  }
  
  private connectSignals(): void {
    // Connect to focus window changes - this is the proper way!
    this.monitorsChangedId = global.backend.get_monitor_manager().connect('monitors-changed', this.onMonitorsChanged.bind(this));
    
    this.workspaceAddedId = global.workspaceManager.connect('workspace-added', this.onWorkspaceAdded.bind(this));
    this.workspaceRemovedId = global.workspaceManager.connect('workspace-removed', this.onWorkspaceRemoved.bind(this));
    this.workspaceReorderedId = global.workspaceManager.connect('workspaces-reordered', this.onWorkspaceReordered.bind(this));
    this.workspaceSwitchedId = global.workspaceManager.connect('workspace-switched', this.onWorkspaceSwitched.bind(this));
    
  }

  private disconnectSignals(): void {
    if (this.workspaceAddedId) {
      global.workspaceManager.disconnect(this.workspaceAddedId);
      this.workspaceAddedId = null;
    }
    if (this.workspaceRemovedId) {
      global.workspaceManager.disconnect(this.workspaceRemovedId);
      this.workspaceRemovedId = null;
    }
    if (this.workspaceReorderedId) {
      global.workspaceManager.disconnect(this.workspaceReorderedId);
      this.workspaceReorderedId = null;
    }
    if (this.workspaceSwitchedId) {
      global.workspaceManager.disconnect(this.workspaceSwitchedId);
      this.workspaceSwitchedId = null;
    }
    
    if (this.monitorsChangedId) {
      global.backend.get_monitor_manager().disconnect(this.monitorsChangedId);
      this.monitorsChangedId = null;
    }
  }
}
