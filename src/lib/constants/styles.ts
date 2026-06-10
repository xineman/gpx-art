export const toolButtonBase =
	'inline-flex aspect-square w-[38px] cursor-pointer items-center justify-center rounded-md border-0 transition-[background,color,transform,opacity] duration-150 ease-in-out hover:bg-[#e6b84a] hover:text-[#1f1d19] disabled:cursor-not-allowed disabled:opacity-40 max-[620px]:w-full';

export const actionButtonBase =
	'inline-flex min-h-[38px] cursor-pointer items-center justify-center gap-[7px] rounded-md border-0 px-[11px] text-[13px] font-extrabold transition-[background,color,transform,opacity] duration-150 ease-in-out hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 max-[620px]:flex-auto max-[620px]:px-[9px]';

export const neutralActionButton = `${actionButtonBase} bg-[#efe1b9] text-[#2c2924] hover:bg-[#e6b84a]`;

export const primaryActionButton = `${actionButtonBase} bg-[#1e7d62] text-[#fff7df] hover:bg-[#155d49]`;
