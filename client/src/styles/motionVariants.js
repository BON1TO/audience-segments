export const pageVariants = {
  initial: { opacity: 0, y: 12, scale: 0.995 },
  in: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: [0.2,0.9,0.3,1] } },
  out: { opacity: 0, y: -8, scale: 0.995, transition: { duration: 0.24 } },
};

export const listItemVariants = {
  initial: { opacity: 0, y: 8, scale: 0.997 },
  animate: i => ({ opacity: 1, y: 0, scale: 1, transition: { delay: 0.03 * i, duration: 0.35, ease: [0.2,0.9,0.3,1] } }),
  exit: { opacity: 0, y: -8, transition: { duration: 0.18 } },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.45 } },
};
