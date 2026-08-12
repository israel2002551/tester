import { useEffect } from 'react';

interface SeoProps {
  title: string;
  description?: string;
  noIndex?: boolean;
}

export function Seo({ title, description, noIndex = false }: SeoProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title.includes('BUYSELL') ? title : `${title} · BUYSELL`;

    const upsert = (selector: string, attribute: string, value: string) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement('meta');
        if (selector.includes('name=')) element.name = selector.match(/name="([^"]+)/)?.[1] ?? '';
        document.head.appendChild(element);
      }
      element.setAttribute(attribute, value);
    };

    if (description) upsert('meta[name="description"]', 'content', description);
    upsert('meta[name="robots"]', 'content', noIndex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large');

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = `${window.location.origin}${window.location.pathname}`;

    return () => { document.title = previousTitle; };
  }, [title, description, noIndex]);

  return null;
}
