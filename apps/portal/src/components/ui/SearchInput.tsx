import { Search } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement>;

export function SearchInput(props: Props) {
  return (
    <label className="ps-search">
      <span className="ps-search__icon">
        <Search size={14} />
      </span>
      <input
        {...props}
        type="search"
        className={`ps-input ps-input--search ${props.className ?? ''}`}
      />
    </label>
  );
}
