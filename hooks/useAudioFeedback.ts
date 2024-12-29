import { useCallback } from 'react'

export function useAudioFeedback() {
  const playAudioFeedback = useCallback(async (text: string) => {
    try {
      console.log('Attempting to fetch audio...')
      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`HTTP error! status: ${response.status}, message: ${JSON.stringify(errorData)}`)
      }

      console.log('Audio fetched successfully, attempting to play...')
      const arrayBuffer = await response.arrayBuffer()
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
      const source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(audioContext.destination)
      source.start(0)
      console.log('Audio played successfully')
    } catch (error) {
      console.error('Detailed error in playAudioFeedback:', error)
      throw error
    }
  }, [])

  return playAudioFeedback
}

