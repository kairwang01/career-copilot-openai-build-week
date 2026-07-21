import React from 'react';

interface LoadingSpinnerProps {
  market?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ market }) => {
  const analyzingText = market ? `Analyzing your resume for the ${market} market...` : 'Analyzing your resume...';
  const descriptionText = market ? `This may take a few moments. We're checking for ATS compliance, standards for the ${market} market, and powerful keywords!` : "This may take a few moments. We're checking for ATS compliance, market standards, and powerful keywords!";

  return (
    <div className="mx-auto my-24 flex max-w-xl flex-col items-center justify-center space-y-4 px-4 text-center animate-fade-in">
      <div className="w-20 h-20 border-4 border-blue-200 dark:border-blue-900 border-t-blue-700 dark:border-t-blue-400 rounded-full animate-spin"></div>
      <p className="text-xl text-gray-800 dark:text-gray-100 font-semibold leading-snug">{analyzingText}</p>
      <p className="text-base text-gray-500 dark:text-gray-400 max-w-md text-center">{descriptionText}</p>
    </div>
  );
};

export default LoadingSpinner;
