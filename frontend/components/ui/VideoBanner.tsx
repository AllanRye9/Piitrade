'use client';

export default function VideoBanner() {
  return (
    <div className="w-full overflow-hidden" style={{ height: '80px' }}>
      <video
        src="/logo.mp4"
        autoPlay
        muted
        loop
        playsInline
        className="w-full h-full object-cover"
        aria-hidden="true"
      />
    </div>
  );
}
