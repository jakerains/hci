import { useState, useEffect, useCallback } from 'react'

export function useVoiceCommands() {
  const [transcript, setTranscript] = useState('')
  const [recognition, setRecognition] = useState<SpeechRecognition | null>(null)

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new webkitSpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true

      recognition.onresult = (event) => {
        const last = event.results.length - 1
        const command = event.results[last][0].transcript
        setTranscript(command)
      }

      setRecognition(recognition)
    }
  }, [])

  const startListening = useCallback(() => {
    if (recognition) {
      recognition.start()
    }
  }, [recognition])

  const stopListening = useCallback(() => {
    if (recognition) {
      recognition.stop()
    }
  }, [recognition])

  return { startListening, stopListening, transcript }
}

