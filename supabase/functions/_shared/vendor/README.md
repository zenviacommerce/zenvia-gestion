WebPDecoder.js is copied verbatim from jsPDF v2.5.1 src/libs/WebPDecoder.js:
https://github.com/parallax/jsPDF/blob/v2.5.1/src/libs/WebPDecoder.js

The original copyright/license notices (Google/WebM and Dominik Homberger) are retained in the file. jsPDF already bundles this decoder. We invoke its RGBA result directly and composite onto white to avoid jsPDF's processWEBP JPEG conversion discarding transparency. No new package or runtime download is introduced. The adjacent declaration file describes only the existing decoder API.
