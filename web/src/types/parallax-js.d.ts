declare module "parallax-js" {
  export default class Parallax {
    constructor(element: HTMLElement, options?: Record<string, unknown>);
    enable(): void;
    disable(): void;
    destroy(): void;
  }
}
