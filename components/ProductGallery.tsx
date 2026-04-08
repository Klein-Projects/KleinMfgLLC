"use client";

import { useState } from "react";
import Image from "next/image";

interface Photo {
  src: string;
  label: string;
}

interface ProductGalleryProps {
  photos: Photo[];
  alt: string;
}

export default function ProductGallery({ photos, alt }: ProductGalleryProps) {
  const [active, setActive] = useState(0);

  return (
    <div>
      {/* Main image */}
      <div className="relative aspect-[3/2] bg-white">
        {photos.map((photo, i) => (
          <Image
            key={photo.src}
            src={photo.src}
            alt={`${alt} — ${photo.label}`}
            fill
            className={`object-contain transition-opacity duration-300 ${
              i === active ? "opacity-100" : "opacity-0"
            }`}

            sizes="(max-width: 768px) 100vw, 50vw"
          />
        ))}
      </div>

      {/* Thumbnail strip */}
      <div className="flex justify-center gap-4 border-t border-navy/10 px-4 py-3">
        {photos.map((photo, i) => (
          <button
            key={photo.src}
            onClick={() => setActive(i)}
            className={`flex flex-col items-center gap-1 rounded-md p-1 transition-colors ${
              i === active
                ? "border-2 border-navy"
                : "border border-navy/20 hover:border-navy/40"
            }`}
          >
            <div className="relative h-[60px] w-[80px]">
              <Image
                src={photo.src}
                alt={photo.label}
                fill
                className="object-contain"
    
                sizes="80px"
              />
            </div>
            <span className="text-xs text-steel text-center">{photo.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
