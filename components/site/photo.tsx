import Image, { type ImageProps } from "next/image";

type PhotoProps = Omit<ImageProps, "src" | "width" | "height" | "fill"> & {
  src: string;
  width: number;
  height: number;
  /** CSS object-position: the spot every frame keeps in view. */
  focus?: string;
};

/** next/image with the stored size, so the page does not jump as photos load. */
export function Photo({ src, alt, focus, style, ...rest }: PhotoProps) {
  return (
    <Image
      src={src}
      alt={alt}
      style={focus ? { ...style, objectPosition: focus } : style}
      {...rest}
    />
  );
}
