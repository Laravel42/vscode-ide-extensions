/**
 * FrameworkDetector — Injected page module (runs in browser context).
 *
 * Detects the active frontend framework on the inspected page and extracts
 * component information (name, hierarchy path, source file, source line)
 * from DOM elements using framework-specific devtools hooks.
 *
 * Detection order is deterministic: react → vue → angular → svelte.
 *
 * This module must NOT import vscode or any Node.js modules.
 * Type-only imports from '../types' are stripped at bundle time.
 */

import type { ComponentInfo, FrameworkType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely access a property on an object, returning undefined on any error.
 */
function safeGet<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Find the first own-property key on an element that starts with the given
 * prefix. Used to locate React fiber keys like `__reactFiber$...`.
 */
function findKeyWithPrefix(el: Record<string, unknown>, prefix: string): string | undefined {
  return Object.keys(el).find((k) => k.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// FrameworkDetector class
// ---------------------------------------------------------------------------

export class FrameworkDetector {
  /**
   * Detect the active framework by probing well-known global hooks.
   * Returns the first detected framework in deterministic order:
   * react → vue → angular → svelte.
   * Returns `null` when no framework is detected.
   */
  detect(): FrameworkType {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;

      if (win.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        return 'react';
      }
      if (win.__VUE_DEVTOOLS_GLOBAL_HOOK__) {
        return 'vue';
      }
      if (win.ng) {
        return 'angular';
      }
      if (win.__svelte_meta) {
        return 'svelte';
      }
    } catch (e) {
      console.warn('[kiro-inspector] Framework detection error:', e);
    }

    return null;
  }

  /**
   * Extract component information for a given DOM element using
   * framework-specific devtools hooks. Returns `null` if no framework
   * component is associated with the element or on any error.
   */
  getComponentInfo(el: Element): ComponentInfo | null {
    const framework = this.detect();
    if (!framework) {
      return null;
    }

    try {
      switch (framework) {
        case 'react':
          return this.getReactComponentInfo(el);
        case 'vue':
          return this.getVueComponentInfo(el);
        case 'angular':
          return this.getAngularComponentInfo(el);
        case 'svelte':
          return this.getSvelteComponentInfo(el);
        default:
          return null;
      }
    } catch (e) {
      console.warn(`[kiro-inspector] Error extracting ${framework} component info:`, e);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // React
  // -----------------------------------------------------------------------

  /**
   * Walk the React fiber tree to extract component info.
   * Fiber nodes are attached to DOM elements via keys like `__reactFiber$...`
   * or `__reactInternalInstance$...`.
   */
  private getReactComponentInfo(el: Element): ComponentInfo | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elAny = el as any;

    const fiberKey =
      findKeyWithPrefix(elAny, '__reactFiber$') ??
      findKeyWithPrefix(elAny, '__reactInternalInstance$');

    if (!fiberKey) {
      return null;
    }

    const fiber = elAny[fiberKey];
    if (!fiber) {
      return null;
    }

    // Walk up the fiber tree to find the nearest function/class component
    let current = fiber;
    let componentName: string | null = null;
    let sourceFile: string | null = null;
    let sourceLine: number | null = null;

    while (current) {
      const type = current.type;
      if (typeof type === 'function' || typeof type === 'object') {
        const name = safeGet(() =>
          typeof type === 'function'
            ? type.displayName || type.name
            : type?.displayName || type?.name,
        );

        if (name) {
          componentName = name;

          // Extract _debugSource if available (React dev builds)
          const debugSource = safeGet(() => current._debugSource);
          if (debugSource) {
            sourceFile = debugSource.fileName ?? null;
            sourceLine = debugSource.lineNumber ?? null;
          }
          break;
        }
      }
      current = current.return;
    }

    if (!componentName) {
      return null;
    }

    // Build component path by walking up the fiber return chain
    const componentPath = this.buildReactComponentPath(fiber);

    return {
      framework: 'react',
      componentName,
      componentPath,
      sourceFile,
      sourceLine,
    };
  }

  /**
   * Walk up the React fiber return chain collecting component names
   * to build the ancestor path (root → leaf order).
   */
  private buildReactComponentPath(fiber: any): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
    const path: string[] = [];
    let current = fiber;

    while (current) {
      const type = current.type;
      const name = safeGet(() =>
        typeof type === 'function'
          ? type.displayName || type.name
          : typeof type === 'object'
            ? type?.displayName || type?.name
            : null,
      );
      if (name) {
        path.push(name);
      }
      current = current.return;
    }

    // Reverse so root component is first
    return path.reverse();
  }

  // -----------------------------------------------------------------------
  // Vue
  // -----------------------------------------------------------------------

  /**
   * Extract component info from Vue 2 (`__vue__`) or Vue 3
   * (`__vueParentComponent`) instances attached to the element.
   */
  private getVueComponentInfo(el: Element): ComponentInfo | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elAny = el as any;

    // Vue 2
    const vue2Instance = safeGet(() => elAny.__vue__);
    if (vue2Instance) {
      return this.extractVue2Info(vue2Instance);
    }

    // Vue 3
    const vue3Instance = safeGet(() => elAny.__vueParentComponent);
    if (vue3Instance) {
      return this.extractVue3Info(vue3Instance);
    }

    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractVue2Info(instance: any): ComponentInfo | null {
    const componentName =
      safeGet(() => instance.$options?.name) ??
      safeGet(() => instance.$options?._componentTag) ??
      'Anonymous';

    const sourceFile = safeGet(() => instance.$options?.__file) ?? null;

    // Build component path by walking $parent chain
    const componentPath: string[] = [];
    let current = instance;
    while (current) {
      const name =
        safeGet(() => current.$options?.name) ??
        safeGet(() => current.$options?._componentTag);
      if (name) {
        componentPath.push(name);
      }
      current = safeGet(() => current.$parent);
    }

    return {
      framework: 'vue',
      componentName,
      componentPath: componentPath.reverse(),
      sourceFile,
      sourceLine: null,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractVue3Info(instance: any): ComponentInfo | null {
    const type = safeGet(() => instance.type);
    const componentName =
      safeGet(() => type?.name) ??
      safeGet(() => type?.__name) ??
      'Anonymous';

    const sourceFile = safeGet(() => type?.__file) ?? null;

    // Build component path by walking parent chain
    const componentPath: string[] = [];
    let current = instance;
    while (current) {
      const t = safeGet(() => current.type);
      const name = safeGet(() => t?.name) ?? safeGet(() => t?.__name);
      if (name) {
        componentPath.push(name);
      }
      current = safeGet(() => current.parent);
    }

    return {
      framework: 'vue',
      componentName,
      componentPath: componentPath.reverse(),
      sourceFile,
      sourceLine: null,
    };
  }

  // -----------------------------------------------------------------------
  // Angular
  // -----------------------------------------------------------------------

  /**
   * Extract component info using Angular's `ng.getComponent()` debug API.
   */
  private getAngularComponentInfo(el: Element): ComponentInfo | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    const ng = safeGet(() => win.ng);
    if (!ng || typeof ng.getComponent !== 'function') {
      return null;
    }

    const component = safeGet(() => ng.getComponent(el));
    if (!component) {
      return null;
    }

    const componentName = safeGet(() => component.constructor?.name) ?? 'Unknown';

    // Build component path by walking up the DOM looking for Angular components
    const componentPath: string[] = [];
    let current: Element | null = el;
    while (current) {
      const comp = safeGet(() => ng.getComponent(current!));
      if (comp) {
        const name = safeGet(() => comp.constructor?.name);
        if (name) {
          componentPath.push(name);
        }
      }
      current = current.parentElement;
    }

    return {
      framework: 'angular',
      componentName,
      componentPath: componentPath.reverse(),
      sourceFile: null,
      sourceLine: null,
    };
  }

  // -----------------------------------------------------------------------
  // Svelte
  // -----------------------------------------------------------------------

  /**
   * Extract component info from Svelte's `__svelte_meta` metadata
   * attached to DOM elements.
   */
  private getSvelteComponentInfo(el: Element): ComponentInfo | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elAny = el as any;

    const meta = safeGet(() => elAny.__svelte_meta);
    if (!meta) {
      return null;
    }

    const loc = safeGet(() => meta.loc);
    const componentName =
      safeGet(() => {
        // Extract component name from file path or metadata
        const file = loc?.file;
        if (file) {
          const parts = file.split('/');
          const filename = parts[parts.length - 1];
          return filename.replace(/\.svelte$/, '');
        }
        return null;
      }) ?? 'Unknown';

    const sourceFile = safeGet(() => loc?.file) ?? null;
    const sourceLine = safeGet(() => {
      const line = loc?.line;
      return typeof line === 'number' ? line : null;
    }) ?? null;

    // Build component path by walking up the DOM looking for Svelte components
    const componentPath: string[] = [];
    let current: Element | null = el;
    while (current) {
      const m = safeGet(() => (current as any).__svelte_meta); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (m) {
        const file = safeGet(() => m.loc?.file);
        if (file) {
          const parts = file.split('/');
          const filename = parts[parts.length - 1];
          componentPath.push(filename.replace(/\.svelte$/, ''));
        }
      }
      current = current.parentElement;
    }

    return {
      framework: 'svelte',
      componentName,
      componentPath: componentPath.reverse(),
      sourceFile,
      sourceLine,
    };
  }
}
