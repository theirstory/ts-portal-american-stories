'use client';

import MuxPlayer from '@mux/mux-player-react';
import { Box, Button, Typography } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import { colors } from '@/lib/theme';

const SHARE_STORY_URL = 'https://theirstory.io/AmericanStories/home-page/s/Neld7Yo8d7/solo';

type GuidanceItem = { label: string; body: string };

const GUIDANCE_ITEMS: GuidanceItem[] = [
  {
    label: 'Participants',
    body: 'We’re happy to hear from you by yourself, you in conversation with a loved one, or in a small group. You can record in the same room or remotely/over Zoom.',
  },
  {
    label: 'Audio & Visual Quality',
    body: 'To look and sound your best, center yourself/selves in the frame, make sure you’re well lit, and check that you’re happy with your background. Do an audio test: shoot yourself/selves for ten seconds speaking normally, then play it back to make sure it sounds great.',
  },
  {
    label: 'Questions and Storytelling',
    body: 'Use the questions below to get started, but don’t let them limit you: We want to hear as many stories as you want to tell us, so we hope you’ll include a story or two in every answer. It’s your anecdotes—how your parents met, your first experience of an American institution (baseball, libraries, Fourth of July!), a vote that was important to you—that will make American Stories come alive. Just let the conversation flow!',
  },
];

type Question = { prompt: string; followUps?: string[] };

const STARTER_QUESTIONS: Question[] = [
  { prompt: 'First, in a minute or two, how did your family become American?' },
  {
    prompt:
      'What is the story of your family’s arrival to America? (For instance, when did they come, why, from where, to where, early experiences, how were they received? etc.)',
    followUps: [
      'If you don’t know your family’s arrival story, what do you know about your family’s roots? (Where did they start out, why, and how?)',
    ],
  },
  { prompt: 'If they chose to be here, why did your family choose America specifically?' },
  { prompt: 'What struggles did your family face before coming to America? And after?' },
  {
    prompt:
      'What would it look like to "make it" in America? Is there a moment you or your family did make it? Or is there a “making it” moment you’re striving for?',
  },
  {
    prompt:
      'What family traditions have been passed down to you? If your family knows their arrival story, are there any traditions they brought from their previous homeland, or any “American” traditions they adopted once they arrived here?',
  },
  {
    prompt:
      'Do you know of any times that your family had to adapt to the culture around them? Or when they resisted that culture?',
  },
  { prompt: 'When did you first personally feel American?' },
  { prompt: 'Is there a moment you or a family member really did not feel American?' },
  { prompt: 'What moment were you proudest of America?' },
  { prompt: 'Who has most personally shaped your American Story, and how?' },
  {
    prompt:
      'Think of the very first people in your family to “become” American. What do you think they wished for you?',
  },
  {
    prompt: 'Think of the very first people in your family to “become” American. What do you wish you could tell them?',
  },
  {
    prompt:
      'Think of the very first people in your family to “become” American. What would your ancestors say if they could see you now?',
  },
  {
    prompt:
      'Let’s flip the lens: Whatever America’s meant to your family, what would you say your family being here has meant for America?',
  },
  { prompt: 'What do you want other Americans to know about you and your family?' },
  { prompt: 'Any stories we missed that you want to tell us?' },
  {
    prompt:
      'Please repeat after me and then fill in the blank: It’s important that we share our American Stories because ____.',
  },
  {
    prompt:
      'Finally, let’s revisit that very first question. In light of everything you’ve shared and reflected on in this conversation, tell us how your family became American.',
  },
];

const CLOSING_LINES = [
  'My name is _____.',
  'My family is from _______.',
  'I live in ______.',
  'And this is my American Story.',
];

type Props = {
  playbackId: string | null;
  videoTitle: string;
};

export const GettingStartedView = ({ playbackId, videoTitle }: Props) => {
  return (
    <Box sx={{ bgcolor: 'background.default', minHeight: 'calc(100dvh - 56px)' }}>
      <Box
        sx={{
          maxWidth: 880,
          mx: 'auto',
          px: { xs: 2, md: 4 },
          py: { xs: 4, md: 6 },
        }}>
        <Typography
          variant="overline"
          sx={{
            letterSpacing: '0.2em',
            color: 'secondary.main',
            fontWeight: 700,
            mb: 1.5,
            display: 'block',
            fontSize: { xs: '0.7rem', md: '0.75rem' },
          }}>
          Getting Started
        </Typography>

        <Typography
          component="h1"
          sx={{
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontSize: { xs: '2rem', md: '2.75rem' },
            fontWeight: 700,
            lineHeight: 1.15,
            color: colors.text.primary,
            mb: { xs: 2.5, md: 3 },
          }}>
          “How did your family become American?”
        </Typography>

        <Typography
          sx={{
            fontFamily: 'var(--font-serif), Georgia, serif',
            fontSize: { xs: '1.05rem', md: '1.2rem' },
            lineHeight: 1.55,
            color: colors.text.primary,
            mb: { xs: 4, md: 5 },
          }}>
          It’s a question that applies to all of us, whether your family arrived centuries ago, were already here, or
          only just made America home. And we at American Stories believe that capturing the answers of Americans
          everywhere will be a powerful testament to how unique—and universal—the collective American story truly is. So
          help us get started by telling us about the people, places, and experiences that shape your American story.
        </Typography>

        {playbackId ? (
          <Box
            sx={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16 / 9',
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: 'common.black',
              boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
              mb: { xs: 4, md: 6 },
              '& mux-player': {
                width: '100%',
                height: '100%',
                '--media-object-fit': 'cover',
              },
            }}>
            <MuxPlayer
              playbackId={playbackId}
              streamType="on-demand"
              thumbnailTime={10}
              metadata={{ video_title: videoTitle }}
              accentColor="#F96044"
              style={{ aspectRatio: '16 / 9' }}
            />
          </Box>
        ) : null}

        <SectionHeading>Conversation Guidance</SectionHeading>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2, md: 2.5 }, mb: { xs: 5, md: 6 } }}>
          {GUIDANCE_ITEMS.map((item) => (
            <Box
              key={item.label}
              sx={{
                p: { xs: 2, md: 2.5 },
                borderRadius: 2,
                border: '1px solid',
                borderColor: colors.grey[200],
                bgcolor: colors.common.white,
              }}>
              <Typography
                sx={{
                  fontSize: { xs: '1rem', md: '1.1rem' },
                  fontWeight: 700,
                  color: 'secondary.main',
                  mb: 0.75,
                }}>
                {item.label}
              </Typography>
              <Typography
                sx={{ fontSize: { xs: '0.95rem', md: '1rem' }, lineHeight: 1.55, color: colors.text.primary }}>
                {item.body}
              </Typography>
            </Box>
          ))}
        </Box>

        <SectionHeading>Conversation Starter Guide</SectionHeading>
        <Box component="ol" sx={{ pl: { xs: 3, md: 4 }, m: 0, mb: { xs: 5, md: 6 } }}>
          {STARTER_QUESTIONS.map((q, idx) => (
            <Box
              component="li"
              key={idx}
              sx={{
                mb: 2,
                pl: 0.5,
                fontFamily: 'var(--font-serif), Georgia, serif',
                fontSize: { xs: '1.05rem', md: '1.15rem' },
                lineHeight: 1.5,
                color: colors.text.primary,
                '&::marker': {
                  color: 'secondary.main',
                  fontWeight: 700,
                },
              }}>
              {q.prompt}
              {q.followUps && q.followUps.length > 0 && (
                <Box component="ul" sx={{ pl: { xs: 2.5, md: 3 }, mt: 0.75, mb: 0 }}>
                  {q.followUps.map((f, i) => (
                    <Box
                      component="li"
                      key={i}
                      sx={{
                        fontFamily: 'var(--font-serif), Georgia, serif',
                        fontSize: { xs: '0.98rem', md: '1.05rem' },
                        lineHeight: 1.5,
                        color: colors.text.secondary,
                        mb: 0.75,
                        '&::marker': { color: colors.text.secondary },
                      }}>
                      {f}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>

        <SectionHeading>Closing, direct to camera</SectionHeading>
        <Box
          sx={{
            p: { xs: 2.5, md: 3 },
            borderRadius: 2,
            border: '1px solid',
            borderColor: colors.grey[200],
            bgcolor: colors.common.white,
            mb: { xs: 5, md: 6 },
          }}>
          {CLOSING_LINES.map((line, i) => (
            <Typography
              key={i}
              sx={{
                fontFamily: 'var(--font-serif), Georgia, serif',
                fontSize: { xs: '1.05rem', md: '1.15rem' },
                lineHeight: 1.7,
                color: colors.text.primary,
              }}>
              {line}
            </Typography>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: { xs: 4, md: 6 } }}>
          <Button
            component="a"
            href={SHARE_STORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<VideocamIcon />}
            sx={{
              px: { xs: 3, md: 4 },
              py: 1.5,
              fontSize: { xs: '0.95rem', md: '1rem' },
              fontWeight: 700,
              letterSpacing: '0.02em',
            }}>
            Record Your American Story
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <Typography
    component="h2"
    sx={{
      fontFamily: 'var(--font-serif), Georgia, serif',
      fontSize: { xs: '1.5rem', md: '1.85rem' },
      fontWeight: 700,
      color: colors.text.primary,
      mb: { xs: 2, md: 2.5 },
      pb: 1,
      borderBottom: '2px solid',
      borderBottomColor: 'secondary.main',
    }}>
    {children}
  </Typography>
);
