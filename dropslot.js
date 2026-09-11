/* =============================================================================
   dropslot.js — the photo tile shared by every screen

   One tile, one view. The entire tile is the target rather than a small native
   file button tucked inside it, and it accepts a dragged file as readily as a
   click, because dragging six photos in from a folder is the normal way anyone
   actually has them to hand.
   ============================================================================= */

/* Attaches picking and dropping to a tile.
     wrap    the tile element
     onFile  called with the chosen File
   Only image files are accepted; anything else is ignored rather than failing
   somewhere further along where the cause would be unclear. */
export function makeDropTile(wrap, onFile) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'picker';
  input.onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) onFile(f);
    // Cleared so re-picking the same file still fires a change event.
    input.value = '';
  };
  wrap.appendChild(input);

  // dragenter and dragleave fire for children too, so a plain toggle flickers
  // as the cursor crosses the thumbnails. Counting entries against leaves keeps
  // the highlight steady.
  let depth = 0;
  const setHot = (on) => wrap.classList.toggle('hot', on);

  wrap.addEventListener('dragenter', (e) => {
    e.preventDefault(); e.stopPropagation();
    depth++; setHot(true);
  });
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  wrap.addEventListener('dragleave', (e) => {
    e.preventDefault(); e.stopPropagation();
    depth = Math.max(0, depth - 1);
    if (!depth) setHot(false);
  });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    depth = 0; setHot(false);
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) onFile(f);
  });

  return input;
}

/* Dropping several files at once onto the grid fills the empty tiles in order,
   so a folder of six can be dragged in as one gesture instead of six. */
export function makeBulkDrop(container, tiles, onFile) {
  let depth = 0;
  const setHot = (on) => {
    for (const t of tiles()) if (!t.filled) t.el.classList.toggle('hot', on);
  };
  container.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; setHot(true); });
  container.addEventListener('dragover',  (e) => { e.preventDefault(); });
  container.addEventListener('dragleave', (e) => {
    e.preventDefault(); depth = Math.max(0, depth-1); if (!depth) setHot(false);
  });
  container.addEventListener('drop', (e) => {
    depth = 0; setHot(false);
    const files = [...(e.dataTransfer.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length < 2) return;      // a single file is the tile's own business
    e.preventDefault(); e.stopPropagation();
    const empty = tiles().filter((t) => !t.filled);
    files.slice(0, empty.length).forEach((f, i) => onFile(empty[i].index, f));
  });
}
