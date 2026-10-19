export interface ToastState { message: string | null; closing: boolean }
export const EMPTY_TOAST: ToastState = { message: null, closing: false };
/** A new message shows at once (and cancels a running exit); null starts the exit if something is shown. */
export function nextToast(state: ToastState, message: string | null): ToastState {
  if (message) return { message, closing: false };
  return state.message ? { ...state, closing: true } : state;
}
export const exitedToast = (): ToastState => EMPTY_TOAST;
