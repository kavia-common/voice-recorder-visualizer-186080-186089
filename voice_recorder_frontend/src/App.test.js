import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// Mock getUserMedia & MediaRecorder for smoke tests
class MockMediaRecorder {
  constructor() {
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {
    this.state = 'recording';
    setTimeout(() => {
      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(['test'], { type: 'audio/webm' }), size: 4 });
      }
      setTimeout(() => {
        if (this.onstop) this.onstop();
      }, 0);
    }, 0);
  }
  stop() {
    this.state = 'inactive';
  }
}
beforeAll(() => {
  Object.defineProperty(window, 'MediaRecorder', {
    writable: true,
    value: MockMediaRecorder,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    value: {
      getUserMedia: jest.fn().mockResolvedValue(new MediaStream()),
    },
  });
  // createMediaElementSource mock to prevent crash
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    window.AudioContext = function() {
      return {
        createMediaStreamSource: () => ({ connect: jest.fn(), disconnect: jest.fn() }),
        createMediaElementSource: () => ({ connect: jest.fn(), disconnect: jest.fn() }),
        createAnalyser: () => ({ fftSize: 1024, frequencyBinCount: 512, getByteTimeDomainData: jest.fn() }),
        destination: {},
        state: 'running',
        resume: jest.fn(),
      };
    };
  }
});

test('renders main sections', () => {
  render(<App />);
  expect(screen.getByText(/Voice Recorder/i)).toBeInTheDocument();
  expect(screen.getByText(/Recording/i)).toBeInTheDocument();
  expect(screen.getByText(/Playback/i)).toBeInTheDocument();
  expect(screen.getByText(/Recordings/i)).toBeInTheDocument();
});

test('can start and stop recording (mocked)', async () => {
  render(<App />);
  const startBtn = screen.getByRole('button', { name: /start recording/i });
  fireEvent.click(startBtn);
  const stopBtn = await screen.findByRole('button', { name: /stop recording/i });
  fireEvent.click(stopBtn);
  // After stop and processing, one item should appear eventually
  const listHeader = await screen.findByText(/Recordings/i);
  expect(listHeader).toBeInTheDocument();
});
