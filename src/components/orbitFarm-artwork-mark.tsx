import './orbitFarm-artwork-mark.css';

/** Visible attribution belongs to the illustration, never to an observation. */
export function ArtworkMark({ className = '' }: { className?: string }) {
  return <span className={`of-artwork-mark ${className}`} data-ai-generated-artwork="true">AI-generated artwork</span>;
}
