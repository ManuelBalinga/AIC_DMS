/** Shared shape for server actions driven by `useActionState`. */
export type ActionState = {
  error?: string;
  success?: string;
};

export const emptyActionState: ActionState = {};
