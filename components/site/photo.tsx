import Image, { type ImageProps } from "next/image";

type PhotoProps = Omit<ImageProps, "src" | "width" | "height" | "fill"> & {
  src: string;
  width: number;
  height: number;
};

/** next/image with the stored size, so the page does not jump as photos load. */
export function Photo({ src, alt, ...rest }: PhotoProps) {
  return <Image src={src} alt={alt} {...rest} />;
}
