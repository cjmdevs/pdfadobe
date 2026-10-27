// An edit the engine will not make, with a message for the user. Nothing on the page
// has changed when one is thrown.
export class EditRefused extends Error {
  constructor(
    message: string,
    /** Letters the chosen font cannot show, when that is the reason. */
    readonly missing: string[] = [],
  ) {
    super(message);
    this.name = "EditRefused";
  }
}
