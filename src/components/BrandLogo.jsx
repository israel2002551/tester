export const brandLogoSources = Object.freeze({
  light: '/brand/svg/buysell_primary_light.svg',
  transparent: '/brand/svg/buysell_transparent_color.svg',
  dark: '/brand/svg/buysell_primary_dark.svg',
  green: '/brand/svg/buysell_reverse_green.svg',
  icon: '/brand/svg/buysell_icon_transparent.svg',
  'icon-dark': '/brand/svg/buysell_icon_dark.svg',
  'icon-green': '/brand/svg/buysell_icon_green.svg',
});

export default function BrandLogo({
  variant = 'light',
  className = '',
  alt = 'BUYSELL Nigeria',
  decorative = false,
}) {
  const source = brandLogoSources[variant] || brandLogoSources.light;
  const isIcon = variant.startsWith('icon');

  return (
    <img
      className={`buysell-logo buysell-logo--${variant} ${className}`.trim()}
      src={source}
      width={isIcon ? 512 : 1200}
      height={isIcon ? 512 : 420}
      alt={decorative ? '' : alt}
      aria-hidden={decorative || undefined}
      decoding="async"
    />
  );
}
