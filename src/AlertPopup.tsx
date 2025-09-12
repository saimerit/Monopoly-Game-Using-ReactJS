// src/AlertPopup.tsx

import React from 'react';

interface AlertPopupProps {
  message: string;
  onClose: () => void;
}

const AlertPopup: React.FC<AlertPopupProps> = ({ message, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 text-center shadow-xl w-96 relative">
        <p className="mb-4">{message}</p>
        <button
          onClick={onClose}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded"
        >
          OK
        </button>
      </div>
    </div>
  );
};

export default AlertPopup;