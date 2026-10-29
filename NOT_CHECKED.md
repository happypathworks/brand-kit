# What no tool checks

`brand_check.js` checks a kit, and every document build runs the same checks
on the kit it reads. These rules in SKILL.md are about the conversation with
the buyer and the files you hand back, and nothing in the skill can check
them. They are listed here so a passing check is never read as covering them.

**Running the check.**
- You should run from the buyer's work folder, never from `SKILL_DIR`: with no path, `brand_check.js` finds the kit from the folder it runs in, exactly as a build there does, so from the skill folder it finds none.
- Exit 3 → the checker crashed on a value it did not expect: report its message, which is not a list of violations — a crash is exit 3, never 1.
- Node's own failure to start the checker is exit 1 with no report (`Cannot find module` means `SKILL_DIR` is wrong), so an exit 1 is violations only when the report ends in a `FAIL —` line. The checker sets the exit code; how you read it to the buyer is not checkable.

**The request.**
- **Asked to design a brand** — pick colours, invent a logo, choose a typeface with no existing identity to work from: you should refuse, and say that this skill captures an identity rather than authoring one.
- Offer instead to run the intake against the neutral defaults so documents build now, and to re-run once an identity exists.
- **Asked to change what a colour is used for** — swap which slot fills the table header rows, drop the info-box header bar, restyle the step card, re-point a text run at a different slot: you should refuse, and say that slot semantics belong to the skill that owns the template.

**The colours.**
- A kit that comes back darker, or with a colour they never chose, is a decision made behind their back unless they made it. Whether the buyer was asked before a colour moved is not checkable; the check sees only the values.
- You should not ask for seven hex values.
- Step 2's scratch `brand.json`: This file is a measurement and should not be written into place.
- When the buyer has to move a slot:
  - **Say where it prints**, not only the ratio: "white header text on your green is 3.35:1, and small print needs 4.5:1 to read reliably" — the document, not the swatch.
  - **Offer choices, with a recommendation.** (a) a darker shade of the same colour, with the proposed hex and its new ratio — usually the recommendation, because it keeps the brand's hue; (b) another colour the brand already owns, if one passes; (c) build on the neutral defaults for now and re-run the intake once the brand owner has ruled.
  - **A slot with no brand colour to fill it should be a question, never a pick.** The commonest is `ALT_ACCENT` when the brand has one hue family: the second path needs a different hue, and choosing one is designing the brand (see Scope boundaries).
- **You should not try to make a tint of the accent readable on the accent.** It is the trap this derivation exists to avoid.

**The organization name.**
- The name's width against the QRG header cell is measured in Arial Bold, whatever `type.FONT` is. In a wider face (Verdana, Tahoma) a name that passes can wrap in the header; whether it fits in the kit's own face is not checked.

**The logo.**
- You should not upscale.
- If none answers, you should not name a tool to the buyer that you have not seen run here: offer the logo as delivered, pass on the margin `brand_check.js` measured on each side (its `logo.trim` line), and say they can send a cropped version if they want one.

**Where the file goes.**
- So "move it into place" means the buyer's own folders, never a skill's: the loader never searches a skill folder (only a build run from inside one reads it), but where you put the file is not checkable.

**The report.**
- Tie each change to the answer in step 2 that chose it; the report confirms an agreement, and nothing in it should be news to the buyer.
- Hard stop 1 says no `brand.json` is written after a non-zero exit. The check makes a failing kit unusable by every build; whether the file was written anyway is not checkable.
- Hard stop 3 says the buyer sees the logo as delivered, trimmed and trimmed with a border. The check gives the margins and the content box; whether the three were shown is not checkable.
