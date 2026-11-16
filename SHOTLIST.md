# Shot list

For one 15-30 s reel. At ~120 BPM that is 12-20 cuts of 0.5-2 s each, so
shoot about twice that: **20-25 clips per place, 5-8 s each**. Extra clips
cost nothing; a missing shot can't be fixed in the edit.

## Phone settings (once)

- Settings > Camera > Record Video: **4K at 30 fps** (60 fps for anything
  you might slow down: water, people walking, pouring).
- Settings > Camera > Formats > **HDR Video: off**. HDR clips get skipped.
- Settings > Privacy > Location Services > Camera: **While Using**.
  GPS is how files get sorted into the right place automatically.
- Shoot **vertical**. Wipe the lens.

## How to hold each clip

- Start recording, wait 1 s, move, hold 1 s at the end, stop. 5-8 s total.
- Move slowly and in one direction only: slower than feels right.
- Tap and hold to lock focus/exposure before moving (AE/AF LOCK).
- Keep the subject in the middle band. Instagram covers the top ~13% and the
  bottom ~20% of the frame with its UI.

## The list (per place)

**Opening (the first 2 seconds decide if people stay)**
- [ ] 1 hero shot: the single best view of the place, wide, moving slowly
- [ ] 1 walking-in POV: through the entrance or along the path

**Wide / establishing**
- [ ] 2 wide shots from different corners
- [ ] 1 slow pan left-to-right across the whole space
- [ ] 1 from up high or down low (stairs, balcony, crouch)

**Details (half the reel is these)**
- [ ] 4-5 close-ups: textures, signs, menu, cups, plants, craft work
- [ ] 1 the name: sign, logo, cup print, menu header
- [ ] 1 slow push-in on one detail (move the phone toward it)

**Life and movement**
- [ ] 2 hands doing something: pouring, painting, paying, turning a page
- [ ] 2 people moving through the frame (backs or distance are fine)
- [ ] 1 natural movement: water, steam, leaves, smoke, lights

**Food / drink (if any)**
- [ ] 1 top-down of the table
- [ ] 1 close-up of the item being picked up or poured

**Ending**
- [ ] 1 calm closing shot that holds for 8 s (wide, or a detail with space
      in the middle for a closing line)
- [ ] 1 walking-away or pull-back shot

**Bonus: makes edits better**
- [ ] 2 "transition" moves: whip the phone fast left or right at the end of a
      clip, and at the start of another. These become seamless whip cuts.
- [ ] 1 match pair: same framing in two moments (e.g. cup full, cup empty)

## After the visit

1. AirDrop everything into `inbox/`. In the share sheet tap **Options** and
   make sure **Location** is on, or the GPS is stripped.
   Don't trim clips: send them whole, the edit picks the moments.
   To force a topic (e.g. a theme reel spanning places), put files in
   `inbox/<topic>/` instead of loose in `inbox/`.
2. `npm run sort` puts it into `topics/<place>/raw/`. New places come out as
   `new-<date>-<n>` with a map link. Rename: `npm run rename-topic <old> <new>`.
3. Tell me which topic to cut.
