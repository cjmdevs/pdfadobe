// In-app help (B8): one topic per feature, rewritten from docs/testing for office users.

import type { HelpTopic } from "./types";

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    summary: "Open files, work with tabs and windows, and save your changes safely.",
    keywords:
      "open file drag drop explorer open with tabs home start screen recent files pin unpin remove window new window move tab save save as backup bak close unsaved",
    sections: [
      {
        heading: "Open a file",
        steps: [
          "Click Open… on the Home screen or the top bar, or press Ctrl+O.",
          "Pick a PDF. It opens in its own tab.",
          "You can also drag PDF files from File Explorer onto the window or onto the Drop PDF files here box.",
          "In File Explorer you can right-click a PDF and choose Open with > PDF Workbench.",
        ],
        tips: [
          "Files on network shares (\\\\server\\share) open the same way as local files.",
          "If a file is already open in another window, that window comes to the front instead of opening a second copy.",
        ],
      },
      {
        heading: "Home screen and Recent files",
        text: "Home shows when the app starts and after you close the last tab. Click the house tab at the left of the tab bar to see it at any time. It has Open…, the drop box, Quick tools and your Recent files.",
        steps: [
          "Click a file in Recent files to open it again.",
          "Click the pin next to a file to keep it at the top of the list. Click it again to unpin.",
          "Click the X next to a file to remove it from the list. The file itself is not touched.",
          "Click Clear all to empty the list.",
        ],
        tips: [
          "A file on a share that can't be reached shows greyed out as Offline. A file that was moved or renamed shows Not found.",
          "To reopen the files you had open last time, turn on Reopen last session's files at start in Preferences > General.",
        ],
      },
      {
        heading: "Tabs and windows",
        steps: [
          "Each open file has a tab. A dot after the name means it has unsaved changes.",
          "Press Ctrl+Tab and Ctrl+Shift+Tab to move between tabs.",
          "To put a file in its own window, drag its tab off the window and let go, or right-click the tab and choose Move to New Window.",
          "To move it back, drag the tab onto the other window's tab bar.",
        ],
        tips: [
          "Unsaved changes and undo history move with the tab.",
          "Ctrl+W closes a tab, Ctrl+Shift+W closes all tabs, Ctrl+Q exits and asks about every unsaved file in every window.",
        ],
      },
      {
        heading: "Save and Save As",
        text: "Save (Ctrl+S) never writes over your file directly. It writes a new copy first, keeps a .bak backup of the old file, and deletes the backup only once the saved file reads back exactly as written. If something goes wrong, the .bak stays and you are told.",
        steps: [
          "Press Ctrl+S to save over the open file.",
          "Press Ctrl+Shift+S (Save As) to save under a new name or folder. The original stays as it was.",
          "If the file is open in another program, you get a message and nothing changes. Close the other program and save again.",
        ],
      },
    ],
  },
  {
    id: "viewing",
    title: "Viewing and finding",
    summary: "Change how pages show, zoom, move around the document and search for text.",
    keywords:
      "view zoom fit page fit width actual size page display single continuous two-up navigate go to page previous view next view back forward scroll pan hand space rotate view navigation pane sidebar find search ctrl+f theme dark",
    sections: [
      {
        heading: "Page display and zoom",
        steps: [
          "Open View > Page display and pick Single page, Single page continuous or Two-up continuous.",
          "Press Ctrl+0 to fit the whole page, Ctrl+2 to fit the width, or Ctrl+1 for actual size.",
          "Press Ctrl+Plus and Ctrl+Minus to zoom in and out.",
        ],
        tips: [
          "Set the zoom and page display new documents open with in Preferences > Page Display.",
        ],
      },
      {
        heading: "Move around the document",
        steps: [
          "Use the page box on the top bar, or press Ctrl+Shift+N to go to a page.",
          "Press Right arrow or Left arrow for the next or previous page, Home or End for the first or last page.",
          "Press Alt+Left (Previous view) to go back to where you were, and Alt+Right (Next view) to go forward again. The back and forward buttons on your mouse do the same.",
          "Hold Shift and turn the mouse wheel to scroll sideways.",
          "Hold Space and drag the page to pan, or turn on View > Hand tool.",
        ],
      },
      {
        heading: "Rotate the view",
        text: "Ctrl+Shift+Plus turns the view clockwise and Ctrl+Shift+Minus turns it back. This only changes what you see and is not saved. To turn pages for good, use Rotate in Organize Pages.",
      },
      {
        heading: "Navigation pane",
        text: "Press F4 to show or hide the navigation pane on the left. Its icons open Pages (thumbnails), Bookmarks and Attachments.",
      },
      {
        heading: "Find text",
        steps: [
          "Press Ctrl+F and type the words you are looking for.",
          "Press Enter or F3 for the next match, Shift+F3 for the previous one.",
          "Press Esc to close the search.",
        ],
        tips: ["Scanned pages can only be searched after Recognize text in Scan & OCR."],
      },
    ],
  },
  {
    id: "pages",
    title: "Organizing pages",
    summary: "Select, reorder, insert, delete, extract, replace and rotate pages.",
    keywords:
      "pages thumbnails organize reorder move drag insert blank delete remove extract replace rotate duplicate crop page size cut copy paste page properties undo",
    sections: [
      {
        heading: "Pages panel and Organize Pages",
        text: "The Pages panel in the navigation pane shows a thumbnail of every page. Organize Pages in the Tools pane shows the pages as a large grid with a toolbar (Insert, Extract, Replace, Split, Rotate left, Rotate right, Delete, Duplicate, Blank page, Crop, Page size).",
        steps: [
          "Click a page to select it.",
          "Ctrl+click to add or remove one page, Shift+click to select a range.",
          "Double-click a thumbnail to go to that page.",
          "Drag selected pages to a new spot. A see-through preview follows the mouse and a line shows where they will go.",
        ],
      },
      {
        heading: "The page menu",
        text: "Right-click a page for its menu: Cut, Copy, Paste before, Paste after, Insert (Blank page… or Pages from a file…), Delete, Extract to new file, Replace…, Rotate and Page properties….",
        tips: [
          "Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste the selected pages. Delete removes them.",
          "Copied pages can be pasted into any tab or window.",
          "Insert accepts PDFs and scanner images such as TIFF and JPEG.",
          "Extract to new file opens the pages in a new tab. Save it to keep it.",
          "Page properties shows a page's size, orientation, rotation and comments.",
        ],
      },
      {
        heading: "Crop and page size",
        steps: [
          "Select the pages in Organize Pages.",
          "Click Crop, type how much to cut from each side, then click Crop.",
          "Or click Page size, choose a size such as Legal, then Apply.",
        ],
      },
      {
        heading: "Undo",
        text: "Every page change can be undone with Ctrl+Z and redone with Ctrl+Y. Hover the undo and redo buttons to see which step they will undo.",
        tips: [
          "If a file is digitally signed, you are warned before a change. Changing it breaks the signature.",
        ],
      },
    ],
  },
  {
    id: "combine-split",
    title: "Combining and splitting files",
    summary: "Merge several files into one PDF, or split one PDF into several files.",
    keywords:
      "combine merge join append files folder bookmarks split break separate extract page range file size",
    sections: [
      {
        heading: "Combine files",
        steps: [
          "Click Combine Files in the Tools pane or File > Combine Files…. A file that is open is already in the list.",
          "Click Add files… or Add folder… to add PDFs and scanner images.",
          "Drag the rows, or use the up and down buttons, to set the order.",
          "To use only some pages of a file, type them in its Page range, for example 1, 3.",
          "Leave Add a bookmark for each file ticked if you want one bookmark per file.",
          "Click Combine. The result opens as a new tab named Combined.pdf. Save it to keep it.",
        ],
        tips: [
          "The files you combined are not changed.",
          "Form fields from each file stay separate, so the same tax form can be combined twice.",
        ],
      },
      {
        heading: "Split a file",
        steps: [
          "Open the file and click Organize Pages, then Split.",
          "Choose how to split: by top-level bookmarks, number of pages per file, page ranges, or maximum file size.",
          "Click Split. The new files are saved next to the original and listed when done.",
        ],
        tips: [
          "Existing files are never overwritten. A new file gets (2) added to its name if needed.",
        ],
      },
    ],
  },
  {
    id: "bookmarks",
    title: "Bookmarks",
    summary: "Add, rename, nest and delete bookmarks, and use them to move pages.",
    keywords:
      "bookmarks outline table of contents navigation add rename nest move pages destination expand collapse",
    sections: [
      {
        heading: "Work with bookmarks",
        steps: [
          "Open Bookmarks in the navigation pane (F4).",
          "Go to a page and click New bookmark. If you select text on the page first, the bookmark is named after it.",
          "Click a bookmark and press F2 to rename it.",
          "To change where a bookmark goes, go to the right page, click the bookmark, and click Set destination to current view.",
          "Select a bookmark and press Delete to remove only the bookmark. The pages stay.",
        ],
      },
      {
        heading: "Move and nest",
        text: "Drag a bookmark onto the top edge of another to move it there, or onto the middle of another to put it inside. While Dragging a bookmark moves its pages is ticked, the bookmark's pages move with it. Untick it to change only the bookmark list.",
      },
      {
        heading: "More bookmark actions",
        tips: [
          "Delete bookmark and its pages removes a section, and tells you how many pages first.",
          "Extract bookmark's pages to new file copies a section into a new tab.",
          "The ⋯ menu has Collapse All, Expand All and Bookmark every page.",
        ],
      },
    ],
  },
  {
    id: "comments",
    title: "Comments and markup",
    summary: "Add sticky notes, highlights, shapes and text boxes, and review comments.",
    keywords:
      "comment markup annotate sticky note highlight underline strikethrough squiggly text box callout rectangle ellipse line arrow polyline polygon cloud draw eraser reply status review flatten xfdf export import summary author",
    sections: [
      {
        heading: "Add comments",
        steps: [
          "Click Comment in the Tools pane.",
          "For Highlight, Underline, Strikethrough or Squiggly, drag over text.",
          "For a Sticky note, click the page. For a Text box or Callout, drag a box and type. Press Esc when done.",
          "For Rectangle, Ellipse, Line or Arrow, drag on the page.",
          "For Polyline, Polygon or Cloud, click each corner and double-click to finish. Draw lets you draw freehand.",
          "Eraser cuts through freehand drawings.",
        ],
      },
      {
        heading: "Change how a comment looks",
        text: "Click a comment to select it. The properties bar under the toolbar changes its color, line width and style. Click Make default to use those settings for the next comment of that type.",
        tips: [
          "The lock button stops a comment being moved or deleted by mistake.",
          "Press Delete to remove the selected comment. Ctrl+Z undoes it.",
          "Your name goes on each comment. Set it in Preferences > Commenting.",
        ],
      },
      {
        heading: "Review comments",
        steps: [
          "Click List on the Comment toolbar, or View > Show or hide > Comments panel.",
          "Click a comment in the list to jump to it.",
          "Type a reply, or set a status such as Accepted.",
          "Use search, sort and the filter to narrow the list.",
        ],
      },
      {
        heading: "Flatten, share and summarize",
        tips: [
          "Flatten draws the comments into the page in a new file, so they can't be changed.",
          "Export saves the comments as an XFDF file. Import adds comments from an XFDF file to the open PDF.",
          "Summary makes a printable PDF with page pictures and numbered comments.",
        ],
      },
    ],
  },
  {
    id: "stamps",
    title: "Stamps",
    summary: "Place standard, dynamic and custom stamps such as Approved or Reviewed.",
    keywords:
      "stamp approved reviewed sign here dynamic custom image favorites palette paste clipboard",
    sections: [
      {
        heading: "Place a stamp",
        steps: [
          "Click Stamp in the Tools pane.",
          "Click Stamp ▾ and pick from Dynamic, Sign Here or Standard Business.",
          "Click the page where the stamp goes.",
        ],
        tips: [
          "Dynamic stamps add your name and the date and time.",
          "Stamps you used recently show at the top of the Stamp menu.",
        ],
      },
      {
        heading: "Favorites and the Stamps palette",
        tips: [
          "Click Add current stamp to favorites to keep a stamp at hand.",
          "Tick Show stamp names to list names instead of pictures.",
          "Stamps Palette (also Window > Stamps palette) shows every stamp in a panel. Click one, then click the page.",
        ],
      },
      {
        heading: "Your own stamps",
        steps: [
          "Click Custom stamps ▾ > Create custom stamp….",
          "Type a category such as Firm and choose a picture (PNG works well).",
          "The stamp now appears under that category in the Stamp menu.",
          "Use Manage stamps… to rename or delete it.",
        ],
        tips: [
          "Paste clipboard image as stamp places a picture you copied, for example from the Snipping Tool.",
        ],
      },
    ],
  },
  {
    id: "workpaper-tools",
    title: "Workpaper tools",
    summary:
      "Tickmarks, connectors, sign-off stamps, notes and the calculator tape for workpapers.",
    keywords:
      "workpaper pdflyer tickmark tick mark footed checks letters numbers connector arrow sign-off prepared by reviewed initials note calculator tape 10-key adding machine foot cross-foot variance legend library stamp summary csv",
    sections: [
      {
        heading: "Tickmarks",
        steps: [
          "Click Workpaper Tools in the Tools pane.",
          "Click the arrow next to a section (Letters, Numbers, Checks, Confirmations, Footing, Other) and pick a tickmark.",
          "Click the page once for each tickmark. Press Esc to stop.",
          "While placing, the number keys pick a tickmark from the Palette.",
        ],
        tips: [
          "Each section button places the last tickmark you used from it.",
          "Matching letters and numbers link to each other. Select one and click Go to the next to jump.",
          "Recent lists what you used. Clear recent stamps empties it.",
          "Legend inserts a box listing every tickmark used in the document.",
        ],
      },
      {
        heading: "Library",
        text: "Library holds the tickmark and sign-off stamp sets. Click New tickmark… or New stamp… to add your own, choose a firm tickmark file, or export and import your set. Your own tickmarks show under Mine.",
      },
      {
        heading: "Connectors, sign-offs and notes",
        tips: [
          "Connector: click the start, then the end. If both ends are on tickmarks, the line stays attached when you move them.",
          "A connector across pages shows a small p. N box at each end. Select it and click Go to the other end.",
          "Sign-off: pick Prepared by, Initials or your own stamp, fill in the reference, click Place, then click the page.",
          "Note: drag a box and type. The Notes tab lists every note.",
          "Stamp Summary lists every workpaper item with page, author and time. Export CSV saves the list.",
        ],
      },
      {
        heading: "Calculator and tape",
        steps: [
          "Click Calculator (also Window > Calculator). Choose 10-key or Standard.",
          "Type amounts on the keyboard, or click Click amounts on page and click numbers in the PDF. Shift+click subtracts.",
          "Click To PDF, then click the page to place the tape.",
          "To change a placed tape, select it and click Open this tape in the calculator, then To PDF again.",
        ],
        tips: ["Decimals, add mode and tape color are in Preferences > PDFlyer."],
      },
      {
        heading: "Footing",
        steps: [
          "In the calculator click Foot / cross-foot.",
          "Drag a box around the amounts to add (up and down to foot, sideways to cross-foot).",
          "Click the total on the page. The calculator says whether it agrees or shows the variance.",
          "Click Mark total to put a tickmark beside the total.",
        ],
        tips: ["Scanned pages need Recognize text first so the amounts can be read."],
      },
    ],
  },
  {
    id: "edit-pdf",
    title: "Editing text and images",
    summary: "Change text and pictures already in a PDF, and add new text, images and links.",
    keywords:
      "edit pdf text change typo paragraph font size bold color image picture add text add image link url crop image flip rotate replace join split bullet list",
    sections: [
      {
        heading: "Edit existing text",
        steps: [
          "Click Edit PDF in the Tools pane. Text boxes get thin outlines.",
          "Click in a paragraph and type. Press Esc when done.",
          "Use the panel on the right to change font, size, color, bold, alignment, lists and spacing.",
          "Drag a box to move it, or drag its side handle to change its width.",
        ],
        tips: [
          "Each change is one undo step (Ctrl+Z).",
          "Ctrl+click two paragraphs and click Join into one paragraph. Split at caret does the opposite.",
          "Tick When text grows, push the text below down to make room for longer text.",
          "If a font can't show a letter you typed, you get a warning and nothing changes.",
        ],
      },
      {
        heading: "Add text and images",
        steps: [
          "Click Add text, then click the page (or drag to set the width) and type.",
          "Click Add image, pick a JPEG or PNG, then click the page.",
          "Drag an image to move it, a corner to resize it, or the round handle to rotate it.",
        ],
        tips: [
          "The panel can flip, rotate, replace, crop and arrange an image. Crop: drag a side handle in, then Apply crop.",
          "Edit Using opens a picture in another program such as Paint. Save there and the PDF updates.",
        ],
      },
      {
        heading: "Links",
        steps: [
          "Click Link, then drag a box over the text.",
          "Type a web address, or choose Go to a page in this document.",
          "Click Add link. Click an existing link to edit or remove it.",
        ],
        tips: ["Tick Visible rectangle to draw a border around the link."],
      },
    ],
  },
  {
    id: "redact",
    title: "Redacting",
    summary: "Permanently remove sensitive content such as SSNs into a new _Redacted file.",
    keywords:
      "redact redaction remove black out hide ssn ein social security sensitive confidential sanitize metadata",
    sections: [
      {
        heading: "Find and mark",
        steps: [
          "Click Redact in the Tools pane.",
          "Under Find what to remove, tick the patterns (SSN is ticked by default) or type text, then click Find.",
          "Check the list of matches, then click Mark all.",
          "To mark by hand, use Draw box, select text and click Mark text, or click Mark page.",
        ],
      },
      {
        heading: "Review and apply",
        steps: [
          "Under Review marks, click a row to jump to it. Accept or Reject each one, or click Accept all.",
          "Choose how the boxes look: fill color and optional overlay text such as Redacted.",
          "Click Apply. A new file named <name>_Redacted.pdf opens. Your original is not changed.",
        ],
        tips: [
          "Redaction removes the text, pictures, drawings, form values and comments under each box. It does not just cover them.",
          "If the same text still shows somewhere you did not mark, nothing is saved and the message says where it is.",
          "A box over one round button removes the whole group of buttons, since they share one answer.",
          "Scanned pages: run Recognize text first so Find can see the words, or draw boxes by hand.",
        ],
      },
      {
        heading: "Sanitize",
        text: "Sanitize (at the bottom of the Redact panel) removes hidden information such as attachments, document properties and hidden text. Leave the options ticked and click Sanitize into a new file. The result is saved as <name>_Sanitized.pdf.",
      },
    ],
  },
  {
    id: "fill-forms",
    title: "Filling forms",
    summary: "Fill in form fields, check required fields, and move form data in and out.",
    keywords:
      "fill form fields type checkbox radio dropdown required reset clear highlight import export data fdf xfdf json csv batch copies flatten irs",
    sections: [
      {
        heading: "Fill a form",
        steps: [
          "Click Fill Forms in the Tools pane.",
          "Click a field and type, or tick boxes and pick from lists. Press Tab to go to the next field.",
          "Press Ctrl+S to save.",
        ],
        tips: [
          "Highlight turns the field tint on and off. Required fields are outlined.",
          "Check required fields tells you what is still empty.",
          "Reset puts every field back to its default. Ctrl+Z undoes it.",
          "Some forms only work in Adobe Acrobat. A notice says so and offers Open in Acrobat.",
        ],
      },
      {
        heading: "Import and export form data",
        steps: [
          "Click Export and choose FDF, XFDF, JSON or CSV. The data file is saved next to the PDF.",
          "On another copy of the form, click Import and pick the data file. The fields fill in.",
        ],
      },
      {
        heading: "Fill copies from a CSV",
        steps: [
          "In the panel click Choose CSV… and pick a spreadsheet saved as CSV, one row per copy.",
          "Choose the column used to name each file.",
          "Click Fill … copies and pick a folder. One filled PDF is made per row. The open form is not changed.",
        ],
      },
      {
        heading: "Flatten",
        text: "Flatten makes a new file where the filled values become part of the page and can no longer be typed in.",
      },
    ],
  },
  {
    id: "prepare-form",
    title: "Preparing forms",
    summary: "Turn a flat PDF into a fillable form by adding or detecting fields.",
    keywords:
      "prepare form create fillable fields text field check box radio button dropdown date signature field detect fields required format",
    sections: [
      {
        heading: "Add fields",
        steps: [
          "Click Prepare Form in the Tools pane.",
          "Click a field type: Text field, Check box, Radio button, Dropdown, Date field or Signature field.",
          "Click the page where the field goes. Press Esc to cancel.",
          "Drag a field to move it, or drag a corner to resize it. Press Delete to remove it.",
          "Select a field to rename it and set options such as Required, Max length or Format, then click Apply.",
        ],
        tips: ["A second radio button placed after the first joins the same group."],
      },
      {
        heading: "Detect fields",
        text: "Click Detect to find blank lines, underscores and boxes on the page and add fields there. Check the result, and press Ctrl+Z to remove them all if it is not right.",
      },
    ],
  },
  {
    id: "scan-ocr",
    title: "Scans and OCR",
    summary: "Make scanned pages searchable, straighten them, and process a folder of scans.",
    keywords:
      "scan ocr recognize text searchable scanned image straighten deskew upright rotate enhance batch folder tesseract",
    sections: [
      {
        heading: "Recognize text",
        steps: [
          "Open a scanned PDF and click Scan & OCR in the Tools pane.",
          "Click Recognize text. Use the arrow to choose In this file or On this page.",
          "Wait for the progress bar. The page looks the same, but you can now search and select its words.",
          "Save the file.",
        ],
        tips: [
          "Pages that already have text are skipped.",
          "You can click Cancel while it runs. Nothing is changed.",
        ],
      },
      {
        heading: "Straighten and enhance",
        steps: [
          "Click Enhance.",
          "Choose Straighten all pages or Straighten this page to level tilted scans.",
          "Choose Turn pages upright for pages scanned sideways or upside down.",
        ],
        tips: ["Ctrl+Z undoes each change."],
      },
      {
        heading: "A folder of scans",
        steps: [
          "Click Recognize text ▾ > In multiple files (a folder)….",
          "Choose the folder. The files are listed.",
          "Click Recognize text. Each scan is saved as a new file ending in _OCR. The originals are not changed.",
        ],
      },
    ],
  },
  {
    id: "page-decorations",
    title: "Headers, watermarks and Bates numbers",
    summary:
      "Add headers and footers, watermarks, backgrounds and Bates numbers, and reduce file size.",
    keywords:
      "header footer page numbers watermark draft background color bates numbering legal prefix optimize reduce file size compress email",
    sections: [
      {
        heading: "Header & Footer",
        steps: [
          "Click Edit PDF, then Header & Footer ▾ > Add….",
          "Click in one of the six boxes and type, or click File Name or a page number item to insert it. The preview shows the result.",
          "Click Apply.",
          "Use Update… to change it later, or Remove to take it off.",
        ],
        tips: [
          "Click Save Settings… to keep a layout, such as a firm footer, and pick it next time under Saved settings.",
          "Set Start page number to continue numbering from another file.",
        ],
      },
      {
        heading: "Watermark and Background",
        steps: [
          "In Edit PDF click Watermark ▾ > Add…. Set the text (such as DRAFT), opacity and angle, then Apply.",
          "For a page color behind the text, click More ▾ > Background > Add…, then Apply.",
          "Use Remove on either menu to take it off.",
        ],
      },
      {
        heading: "Bates numbering",
        steps: [
          "In Edit PDF click More ▾ > Bates numbering > Add… (also in Scan & OCR).",
          "Type a prefix and the number of digits.",
          "Click Add files… to number more files in one run, in order.",
          "Click Apply. Each file is saved as a new file ending in _Bates.",
        ],
      },
      {
        heading: "Reduce file size",
        steps: [
          "Click Optimize PDF in the Tools pane.",
          "Pick a setting such as Email and click Reduce file size.",
          "Check the before and after sizes, then save the smaller copy. It ends in _Optimized.",
        ],
      },
    ],
  },
  {
    id: "create-export",
    title: "Creating and exporting PDFs",
    summary:
      "Make PDFs from Office files and images, and save PDFs as Word, Excel, images or text.",
    keywords:
      "create pdf convert word excel powerpoint office docx xlsx images tiff jpeg export save as word excel png jpeg text txt",
    sections: [
      {
        heading: "Create PDF",
        steps: [
          "Click Create PDF in the Tools pane or File > Create PDF….",
          "Add Word, Excel or PowerPoint files, PDFs or images, one by one or a whole folder.",
          "Choose one PDF per file, or One combined PDF. For a combined PDF, use the up and down buttons to set the order.",
          "Leave Recognize text ticked to make scanned images searchable.",
          "Click Create. New PDFs are saved next to the originals and open in tabs.",
        ],
        tips: [
          "Microsoft Office must be installed to convert Office files.",
          "Existing files are never overwritten. A new name such as Letter (2).pdf is used.",
          "Password-protected Office files are not converted. You get a message naming them.",
        ],
      },
      {
        heading: "Export PDF",
        steps: [
          "Open the PDF and click Export PDF in the Tools pane or File > Export PDF….",
          "Pick Word document (.docx), Excel workbook (.xlsx), an image format such as PNG, or Plain text (.txt).",
          "For images, choose the resolution and pages.",
          "Click Export. The file is saved next to the PDF.",
        ],
        tips: [
          "Word layouts can shift a little. Check the result.",
          "Excel puts each page on its own sheet and turns amounts into numbers you can add up.",
        ],
      },
    ],
  },
  {
    id: "signing",
    title: "Signing",
    summary: "Add your signature or initials, and sign digitally with a certificate.",
    keywords:
      "sign signature initials fill and sign date check mark digital signature certificate pfx windows store signatures panel valid",
    sections: [
      {
        heading: "Fill & Sign",
        steps: [
          "Click Fill & Sign in the Tools pane.",
          "Click Sign ▾ > Add signature… or Add initials….",
          "Type your name and pick a style, draw with the mouse or pen, or choose an image.",
          "Click Save and place, then click the page. Drag a corner to resize.",
        ],
        tips: [
          "Saved signatures are listed under Sign ▾ next time and are stored encrypted on your PC.",
          "Tick Add the date under signatures to add today's date.",
          "Text, Check, X, Dot and Date place quick marks where you click.",
        ],
      },
      {
        heading: "Sign with a certificate",
        steps: [
          "Click Certificates in the Tools pane.",
          "Click Digitally sign and drag a box, or click Invisible for a signature with no box. You can also click an empty signature field.",
          "Pick a certificate from Windows, or choose a .pfx file and type its password.",
          "Click Sign and save as a new file. The signed copy ends in _Signed.",
        ],
      },
      {
        heading: "Signatures panel",
        text: "The Signatures panel lists each digital signature and whether it is valid. If the file changed after a signature, it says so. Click View signed version to see the file as it was signed.",
      },
    ],
  },
  {
    id: "protect",
    title: "Passwords and security",
    summary: "Add a password or restrictions to a PDF, or remove them.",
    keywords:
      "protect password encrypt security permissions restrict printing copying remove security unlock decrypt",
    sections: [
      {
        heading: "Protect a PDF",
        steps: [
          "Click Protect in the Tools pane, then Protect.",
          "Type an open password twice. Anyone opening the file will need it.",
          "To limit printing, changes or copying, tick Restrict printing, changes and copying and set a permissions password.",
          "Click Save a protected copy. The copy ends in _Protected.",
        ],
        tips: [
          "A permissions password alone is not real protection. Use an open password for confidential files.",
        ],
      },
      {
        heading: "Remove security",
        steps: [
          "Open the protected file with its password.",
          "Click Protect > Remove security and type the password.",
          "Click Save an unprotected copy. The copy ends in _Unprotected.",
        ],
      },
    ],
  },
  {
    id: "customizing",
    title: "Menus, search and preferences",
    summary: "Use the menu bar, search for commands, change preferences and set up the top bar.",
    keywords:
      "menu bar file edit view window help alt search commands alt+q preferences settings ctrl+k options snap snapping guides alt readout customize top bar toolbar quick tools reset overflow tooltips shortcuts keyboard theme",
    sections: [
      {
        heading: "Menu bar and search",
        text: "The menu bar has File, Edit, View, Window and Help. Press Alt to open it from the keyboard. Edit > Search commands (Alt+Q) finds tools, menu commands and settings by name.",
        tips: [
          "Hover a button to see its name and keyboard shortcut. Help > Keyboard shortcuts lists them all.",
          "F1 opens these help topics.",
        ],
      },
      {
        heading: "Preferences",
        text: "Edit > Preferences (Ctrl+K) has these categories: General, Page Display, Commenting, Edit PDF, Fonts, PDFlyer, Security and Updates. For example, set your author name in Commenting and the calculator in PDFlyer.",
      },
      {
        heading: "Snapping and position readout",
        text: "When you drag or resize a box (a comment, redaction box, text box, stamp or field), it snaps to the page edges and nearby objects. Hold Alt to place it freely. While dragging, a readout shows X/Y and W/H. Turn either off in Preferences > Edit PDF.",
      },
      {
        heading: "Customize the top bar",
        steps: [
          "Click Window > Customize top bar….",
          "For each item, choose to keep it on the bar, move it into a menu, or hide it.",
          "Click Reset to default to go back to the standard layout.",
        ],
        tips: [
          "When the window is narrow, items that don't fit move into the » menu.",
          "Window > Reset top bar also goes back to the standard layout.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    summary:
      "What to do when a file won't open or save, and where to find updates and crash reports.",
    keywords:
      "problem error can't open damaged corrupt repair password locked open in acrobat crash report update default program associate",
    sections: [
      {
        heading: "A file won't open or work",
        tips: [
          "Most error messages have an Open in Acrobat button, so you can carry on in Adobe Acrobat.",
          "If a file is damaged, click Repair a copy…. The repaired file is saved as a new file and the original is not changed.",
          "Password-protected files ask for the password when they open.",
          "If another program has the file locked, close it and click Try again.",
        ],
      },
      {
        heading: "Crash reports and updates",
        tips: [
          "Help > Crash reports folder opens the folder of crash reports. They contain no file names or document text.",
          "Help > Check for updates looks for a newer version from the firm.",
        ],
      },
      {
        heading: "Make PDF Workbench the default PDF program",
        steps: [
          "Click Help > Default PDF program….",
          "Windows Settings opens at PDF Workbench's Default apps page.",
          "Next to .pdf, pick PDF Workbench and click Set default.",
        ],
      },
    ],
  },
];
