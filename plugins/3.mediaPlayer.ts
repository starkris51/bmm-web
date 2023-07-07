import { TrackModel } from "@bcc-code/bmm-sdk-fetch";

const authToken: Ref<string | undefined> = ref();

export enum MediaPlayerStatus {
  Paused = "PAUSED",
  Playing = "PLAYING",
  Stopped = "STOPPED",
}

export class Queue extends Array<TrackModel> {
  public isShuffled = false;

  i = 0;

  get index() {
    return this.i;
  }

  set index(v) {
    this.i = v;
    this.currentTrack = this[v];
  }

  public currentTrack: TrackModel | undefined;

  sortedArray: Array<TrackModel> | undefined;

  constructor(data: TrackModel[] = [], index = 0) {
    super();

    if (!Array.isArray(data)) return;

    data.forEach((el, i) => {
      this[i] = el;
    });

    this.index = index;
  }

  public shuffle() {
    if (this.sortedArray) return;

    const playingTrack = this.currentTrack;
    this.sortedArray = [...this];
    this.sort((a, b) => {
      if (a === this.currentTrack) return -1;
      if (b === this.currentTrack) return 1;
      return Math.random() - 0.5;
    });
    this.isShuffled = true;
    this.i = this.findIndex((v) => v === playingTrack) || 0;
  }

  public unshuffle() {
    if (!this.sortedArray) return;

    const playingTrack = this.currentTrack;
    this.sortedArray.forEach((el, i) => {
      this[i] = el;
    });
    this.sortedArray = undefined;
    this.isShuffled = false;
    this.i = this.findIndex((v) => v === playingTrack) || 0;
  }
}

export interface MediaPlayer {
  status: ComputedRef<MediaPlayerStatus>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  hasNext: ComputedRef<Boolean>;
  hasPrevious: ComputedRef<Boolean>;
  queue: Readonly<Ref<Queue>>;
  currentTrack: ComputedRef<TrackModel | undefined>;
  currentPosition: Ref<number>;
  currentTrackDuration: Ref<number>;
  setQueue: (queue: TrackModel[], index?: number) => void;
  addToQueue: (track: TrackModel) => void;
  playNext: (track: TrackModel) => void;
}

export const initMediaPlayer = (
  createMedia: (src: string) => HTMLAudioElement
): MediaPlayer => {
  // Good to know when writing tests: https://github.com/jsdom/jsdom/issues/2155#issuecomment-366703395
  let activeMedia: HTMLAudioElement | undefined;

  const loading = ref(false);
  const paused = ref(true);
  const ended = ref(true);
  const currentPosition = ref(0);
  const currentTrackDuration = ref(0);

  const queue: Ref<Queue> = ref(new Queue([], 0));

  const playerStatus = computed(() => {
    if (ended.value) return MediaPlayerStatus.Stopped;
    if (paused.value) return MediaPlayerStatus.Paused;
    return MediaPlayerStatus.Playing;
  });

  const hasNext = computed(() => queue.value.length > queue.value.index + 1);

  function next() {
    if (!hasNext.value) return;
    queue.value.index += 1;
  }

  function initCurrentTrack() {
    const track = queue.value[queue.value.index];
    if (!track) return;

    activeMedia?.pause();

    activeMedia = createMedia(
      authorizedUrl(track.media?.[0]?.files?.[0]?.url || "", authToken.value)
    );
    activeMedia.autoplay = true;
    loading.value = true;
    paused.value = true;
    ended.value = false;
    currentPosition.value = 0;
    currentTrackDuration.value = 0;

    useNuxtApp().$appInsights.trackEvent({
      name: "track playback started",
      properties: {
        trackId: track.id,
      },
    });

    activeMedia.addEventListener("loadedmetadata", () => {
      currentTrackDuration.value = activeMedia!.duration;
    });
    activeMedia.addEventListener("timeupdate", () => {
      currentPosition.value = activeMedia!.currentTime;
    });
    activeMedia.addEventListener("pause", () => {
      paused.value = true;
    });
    activeMedia.addEventListener("loadstart", () => {
      loading.value = true;
    });
    activeMedia.addEventListener("loadeddata", () => {
      loading.value = false;
    });
    activeMedia.addEventListener("play", () => {
      paused.value = false;
      ended.value = false;
    });
    activeMedia.addEventListener("playing", () => {
      paused.value = false;
    });
    activeMedia.addEventListener("ended", () => {
      paused.value = true;
      ended.value = true;
      useNuxtApp().$appInsights.trackEvent({
        name: "track completed",
        properties: {
          trackId: track.id,
        },
      });
      // Play next track if there is one
      next();
    });
  }

  watch(
    () => [queue.value.currentTrack, queue.value],
    () => {
      initCurrentTrack();
    }
  );

  const hasPrevious = computed(() => queue.value.index > 0);

  function previous() {
    if (!hasPrevious.value) return;
    queue.value.index -= 1;
  }

  function continuePlayingIfEnded() {
    if (ended.value) {
      initCurrentTrack();
    }
  }

  function addToQueue(track: TrackModel) {
    queue.value.push(track);
    continuePlayingIfEnded();
  }

  function setQueue(_queue: TrackModel[], index = 0): void {
    queue.value = new Queue(_queue, index);
  }

  function playNext(track: TrackModel): void {
    queue.value.splice(queue.value.index + 1, 0, track);
    continuePlayingIfEnded();
  }

  return {
    status: playerStatus,
    play: () => {
      if (activeMedia) {
        activeMedia.play();
      } else {
        initCurrentTrack();
      }
    },
    pause: () => {
      activeMedia?.pause();
    },
    stop: () => {
      // https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Client-side_web_APIs/Video_and_audio_APIs#stopping_the_video, https://html.spec.whatwg.org/multipage/media.html#best-practices-for-authors-using-media-elements
      if (activeMedia) {
        activeMedia.pause();
        activeMedia.srcObject = null;
        activeMedia = undefined;
        ended.value = true;
      }
    },
    next,
    previous,
    hasNext,
    hasPrevious,
    currentTrack: computed(() => queue.value.currentTrack),
    currentPosition: computed({
      get: () => currentPosition.value,
      set: (value) => {
        if (activeMedia) {
          activeMedia.currentTime = value;
        }
      },
    }),
    currentTrackDuration,
    queue,
    setQueue,
    addToQueue,
    playNext,
  };
};

export default defineNuxtPlugin((nuxtApp) => {
  const { getAccessTokenSilently, isAuthenticated } =
    nuxtApp.vueApp.config.globalProperties.$auth0;

  watch(
    isAuthenticated,
    async (authenticated) => {
      authToken.value = authenticated
        ? await getAccessTokenSilently()
        : undefined;
    },
    { immediate: true }
  );

  return {
    provide: {
      mediaPlayer: initMediaPlayer((src) => new Audio(src)),
    },
  };
});
