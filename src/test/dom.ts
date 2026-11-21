/**
 * Helpers for component tests running in jsdom. jsdom does not implement <dialog>
 * showModal/close, so minimal versions are provided.
 */
export function polyfillDialog(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  if (!proto.showModal || String(proto.showModal).includes('not implemented')) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}
