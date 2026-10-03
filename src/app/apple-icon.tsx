import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
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
          borderRadius: "34px",
          position: "relative",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 32,
            right: 24,
            width: 28,
            height: 18,
            background: "#22c55e",
            borderRadius: "50% 50% 50% 50% / 60% 40% 60% 40%",
            transform: "rotate(-30deg)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 47,
            right: 33,
            width: 2,
            height: 18,
            background: "#16a34a",
            transform: "rotate(-30deg)",
            borderRadius: 999,
          }}
        />
        <div
          style={{
            color: "#facc15",
            fontSize: 110,
            fontWeight: 900,
            lineHeight: 1,
            transform: "translateY(-2px)",
          }}
        >
          ⚡
        </div>
      </div>
    ),
    size,
  );
}
