import { Link } from 'react-router-dom';
import logoLight from '../assets/brand/buysell_primary_light.svg';
import logoReverse from '../assets/brand/buysell_reverse_green.svg';

interface BrandProps {
  inverse?: boolean;
  compact?: boolean;
  className?: string;
}

export function Brand({ inverse = false, compact = false, className = '' }: BrandProps) {
  return (
    <Link className={`brand ${className}`} to="/" aria-label="BUYSELL home">
      <img src={inverse ? logoReverse : logoLight} alt="BUYSELL" className={compact ? 'brand__image brand__image--compact' : 'brand__image'} />
    </Link>
  );
}
