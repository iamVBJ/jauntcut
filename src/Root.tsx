import React from "react";
import { Composition, Folder } from "remotion";
import { Reel } from "./Reel";
import { reelSchema } from "./schema";
import { topics } from "./topics.generated";
import { FPS, HEIGHT, WIDTH, totalFrames } from "./lib";

// One composition per folder in topics/. Add topics with `npm run new <slug>`.
export const RemotionRoot: React.FC = () => (
  <Folder name="Reels">
    {topics.map((t) => {
      const parsed = reelSchema.safeParse(t);
      if (!parsed.success) {
        // A topic that isn't filled in yet shouldn't take the others down.
        console.warn(`Skipping topic ${t.slug}: ${parsed.error.message}`);
        return null;
      }
      const props = parsed.data;
      return (
        <Composition
          key={props.slug}
          id={props.slug}
          component={Reel}
          schema={reelSchema}
          defaultProps={props}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          durationInFrames={totalFrames(props)}
          calculateMetadata={({ props: p }) => ({ durationInFrames: totalFrames(reelSchema.parse(p)) })}
        />
      );
    })}
  </Folder>
);
