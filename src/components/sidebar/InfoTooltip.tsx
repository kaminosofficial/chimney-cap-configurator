import { useState, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

export function InfoTooltip({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<'above' | 'below'>('above');
  const [horizontalShift, setHorizontalShift] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (window.matchMedia('(hover: hover)').matches) {
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (window.matchMedia('(hover: hover)').matches) {
      setIsOpen(false);
    }
  };

  const handleClick = (e: ReactMouseEvent) => {
    if (!window.matchMedia('(hover: hover)').matches) {
      e.preventDefault();
      setIsOpen(prev => !prev);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (!isOpen || !containerRef.current) return;
      
      const path = e.composedPath();
      if (!path.includes(containerRef.current)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && containerRef.current && tooltipRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      
      const scrollParent = containerRef.current.closest('.sidebar-scroll');
      if (scrollParent) {
        const scrollRect = scrollParent.getBoundingClientRect();
        
        const spaceAbove = containerRect.top - scrollRect.top;
        if (spaceAbove < 80) {
          setPosition('below');
        } else {
          setPosition('above');
        }
        
        const padding = 16;
        const rightEdge = scrollRect.right - padding;
        const leftEdge = scrollRect.left + padding;
        
        const center = containerRect.left + containerRect.width / 2;
        const halfWidth = tooltipRect.width / 2;
        
        let shift = 0;
        if (center + halfWidth > rightEdge) {
          shift = rightEdge - (center + halfWidth);
        } else if (center - halfWidth < leftEdge) {
          shift = leftEdge - (center - halfWidth);
        }
        setHorizontalShift(shift);
      }
    }
  }, [isOpen]);

  return (
    <div 
      ref={containerRef}
      className={`info-tooltip-wrap ${isOpen ? 'active' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <svg className="info-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="7" cy="7" r="7" fill="currentColor"/>
        <path d="M6.25 4C6.25 3.58579 6.58579 3.25 7 3.25C7.41421 3.25 7.75 3.58579 7.75 4C7.75 4.41421 7.41421 4.75 7 4.75C6.58579 4.75 6.25 4.41421 6.25 4ZM6.25 10.25V6H7.75V10.25H6.25Z" fill="#fff"/>
      </svg>
      {isOpen && (
        <div 
          ref={tooltipRef}
          className={`info-tooltip info-tooltip--${position}`}
          style={{ transform: `translateX(calc(-50% + ${horizontalShift}px))` }}
        >
          {text}
          <div className="info-tooltip-arrow" style={{ transform: `translateX(${-horizontalShift}px)` }} />
        </div>
      )}
    </div>
  );
}
