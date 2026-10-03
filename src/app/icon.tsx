import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1f2937",
          borderRadius: "100px",
          position: "relative",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 88,
            right: 74,
            width: 72,
            height: 46,
            background: "#22c55e",
            borderRadius: "50% 50% 50% 50% / 60% 40% 60% 40%",
            transform: "rotate(-30deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 125,
            right: 100,
            width: 4,
            height: 40,
            background: "#16a34a",
            transform: "rotate(-30deg)",
            borderRadius: 999,
          }}
        />
        <div
          style={{
            color: "#facc15",
            fontSize: 300,
            fontWeight: 900,
            lineHeight: 1,
            transform: "translateY(-6px)",
          }}
        >
          ⚡
        </div>
      </div>
    ),
    size,
  );
}
