// The room a page takes on screen: its size at the current zoom, with width and height
// swapped when it is shown turned a quarter either way.

export interface Size {
  width: number;
  height: number;
}

/** `quarterTurns`: page rotation plus view rotation, in quarter turns. */
export function shownSize(size: Size, quarterTurns: number, scale: number): Size {
  const turned = Math.abs(quarterTurns) % 2 === 1;
  return {
    width: (turned ? size.height : size.width) * scale,
    height: (turned ? size.width : size.height) * scale,
  };
}
