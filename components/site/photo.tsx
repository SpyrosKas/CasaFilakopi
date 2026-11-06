import Image, { type ImageProps } from "next/image";
import imageSizes from "@/content/image-sizes.json";

type PhotoProps = Omit<ImageProps, "src" | "width" | "height" | "fill"> & {
  src: string;
};

/** next/image with the size filled in from content/image-sizes.json. */
export function Photo({ src, alt, ...rest }: PhotoProps) {
  const [width, height] = (imageSizes as Record<string, number[]>)[src];
  return <Image src={src} alt={alt} width={width} height={height} {...rest} />;
}
