please implement a tool that takes a long document as input and produces a multi-speaker audio file that reads it out.

The system should work as follows:

document input => converted to plaintext
(if its already plaintext thats fine, if its a PDF or a HTML file then it should be somehow turned into readable text.)

An LLM should then process the document.  (let's say an openrouter/openai compatable endpoint is available to process the document) It should possibly do a first pass where it studies the document and defines the 'speakers' required:
1 speaker for the 'narrator', 1 speaker for each character in the document. so if for example a female character is quoted, it should use a specific female voice for that character and keep using that same one for the whole document. Maybe you can even write a very short 'voice description' for zero-shot voice systems - but for most TTS we will have to just pick from a set of predefined voices.
Then it should transform the document into a jsonl file where each block of text is annotated with the speaker name.

Then we need to perform a process to transforming using some kind of audio conversion endpoint. make the system modular to some extent so that we can swap out API endpoints for whatever provides the best multi-speaker TTS. One common issue with TTS systems is that they sometimes only take short snippets, so if that's a requirement of the system maybe send just one sentence at a time to be transformed.

And of course at the end all of these audio clips must be edited together (maybe ffmpeg?).

OK so the basic idea is that we can utilize TTS systems to read long documents. they might be interviews or stories, but in any case the key thing is character consistency. each speaker has a unique voice. The text gets processed by an LLM to jsonl to annotate each piece of text with the speaker name so taht it can easily be turned into audio.

This should be implemented as a website with a backend system with a job queue. Since the processes involved all take time and have many steps it's very useful to implement progress bars for this, time estimates, clarify of what is happening right now. and also we need some fault tolerence, if something goes wrong it would be ideal if we lose the minimal amount of data and are able to continue from where we got to.

If you need any additional research on how TTS systems work for voices and emotions and things, feel free to look that up or I can try to find information you need too. Also feel free to critize the design and improve it in any ways you believe would make it even better! Thanks so much for your help!
