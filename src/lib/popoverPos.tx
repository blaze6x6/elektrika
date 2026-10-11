"use client";
import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Položaj pojavnega okna (paleta tem, namestitev aplikacije) glede na gumb, ki ga odpre.
 * Okno je `position: fixed` in vedno omejeno na vidno področje zaslona – tudi v pokončnem pogledu na telefonu,
 * kjer gumb ni ob desnem robu in bi se okno sicer odprlo (delno) izven zaslona.
 */
export function usePopoverStyle(open: boolean, anchorRef: RefObject<HTMLElement | null>, preferredWidth: number): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  const compute = () => {
    const el = anchorRef.current;
    if (!el) return;
    // merimo gumb (prvi otrok), ne ovojnega elementa – ta ob prvem izrisu vsebuje še okno samo
    const r = (el.firstElementChild ?? el).getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(preferredWidth, vw - margin * 2);
    // poravnaj desni rob okna z desnim robom gumba, nato ga potisni v zaslon
    const left = Math.max(margin, Math.min(r.right - width, vw - width - margin));
    const top = r.bottom + 4;
    setStyle({ position: "fixed", top, left, width, maxHeight: Math.max(160, vh - top - margin), overflowY: "auto" });
  };

  useLayoutEffect(() => {
    if (open) compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
      window.removeEventListener("scroll", compute, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return open ? style : undefined;
}
