/**
 * Limits shared by the server actions and the forms that feed them.
 *
 * Deliberately not in `config.ts`: that file is `server-only`, and the composer
 * and rename forms are client components. A `maxLength` the browser enforces
 * and a length check the action enforces must be the same number, and the only
 * way to guarantee that is for both to read this one.
 */

/** Longest a single message may be. Past this it is a document, not a message. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Longest a group thread's name may be. */
export const MAX_TOPIC_LENGTH = 120;
